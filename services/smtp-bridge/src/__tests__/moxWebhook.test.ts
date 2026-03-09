import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import nacl from 'tweetnacl';
import { createApp } from '../app.js';
import { EmailEncryptor } from '../services/emailEncryptor.js';
import { ManifestManager } from '../services/manifestManager.js';
import { NotificationQueue } from '../services/notificationQueue.js';
import { AliasLookupService } from '../services/aliasLookup.js';
import { EmailKeyLookupService } from '../services/emailKeyLookup.js';
import { transformMoxPayload } from '../routes/moxWebhook.js';
import type { BridgeContext } from '../types/context.js';
import type { MoxWebhookPayload } from '../types/moxWebhook.js';

// Mock metrics
vi.mock('../metrics.js', () => ({
  emailsReceived: { inc: vi.fn() },
  encryptionErrors: { inc: vi.fn() },
  txErrors: { inc: vi.fn() },
  rpcDuration: { observe: vi.fn() },
  metricsHandler: vi.fn((_req: any, res: any) => res.end('# metrics')),
}));

const WEBHOOK_SECRET = 'test-secret';

function createMockContext(): BridgeContext {
  const recipientKeyPair = nacl.box.keyPair();

  const config = {
    port: 3000,
    batchWindowMs: 30_000,
    rateLimitPerAlias: 100,
    webhookSecret: WEBHOOK_SECRET,
  } as any;

  const mockIpfs = {
    upload: vi.fn().mockResolvedValue('bafyreimockemailcid'),
    download: vi.fn(),
  };

  const aliasLookup = new AliasLookupService(config);
  aliasLookup.setQueryFn(async () => 'contract-address-abc');

  const emailKeyLookup = new EmailKeyLookupService(config);
  emailKeyLookup.setQueryFn(async () => recipientKeyPair.publicKey);

  const manifestManager = new ManifestManager(mockIpfs as any);
  vi.spyOn(manifestManager, 'appendAndUpload').mockResolvedValue('bafyreimockmanifest');

  const notificationQueue = new NotificationQueue(config);
  notificationQueue.setNotifyFn(async () => {});
  vi.spyOn(notificationQueue, 'enqueue');

  return {
    config,
    aliasLookup,
    emailKeyLookup,
    emailEncryptor: new EmailEncryptor(),
    manifestManager,
    notificationQueue,
    ipfs: mockIpfs as any,
    walletReady: true,
    readInboxManifestCid: vi.fn().mockResolvedValue('bafyreiexistingmanifest'),
    checkIndexerHealth: vi.fn().mockResolvedValue(true),
  };
}

function authHeader() {
  return { Authorization: `Bearer ${WEBHOOK_SECRET}` };
}

function createMoxPayload(overrides?: Partial<MoxWebhookPayload>): MoxWebhookPayload {
  return {
    Version: 0,
    From: [{ Name: 'Sender', Address: 'sender@example.com' }],
    To: [{ Name: '', Address: 'alias@alias.id' }],
    CC: [],
    Subject: 'Hello from Mox',
    MessageID: '<abc@mox.example>',
    Date: '2026-03-08T00:00:00Z',
    Text: 'Email body text\n',
    HTML: '<p>Email body</p>',
    Structure: {
      ContentType: 'text/plain',
      ContentDisposition: '',
      Filename: '',
      DecodedSize: 15,
      Parts: [],
    },
    Meta: {
      MsgID: 201,
      MailFrom: 'sender@example.com',
      RcptTo: 'alias@alias.id',
      DKIMVerifiedDomains: ['example.com'],
      RemoteIP: '203.0.113.1',
      Received: '2026-03-08T00:00:03Z',
      MailboxName: 'Inbox',
      Automated: false,
    },
    ...overrides,
  };
}

describe('transformMoxPayload', () => {
  it('extracts from, to, subject, body from Mox payload', () => {
    const mox = createMoxPayload();
    const result = transformMoxPayload(mox);

    expect(result.from).toBe('sender@example.com');
    expect(result.to).toBe('alias@alias.id');
    expect(result.subject).toBe('Hello from Mox');
    expect(result.body).toBe('Email body text\n');
  });

  it('prefers Text over HTML for body', () => {
    const mox = createMoxPayload({ Text: 'plain text', HTML: '<p>html</p>' });
    const result = transformMoxPayload(mox);

    expect(result.body).toBe('plain text');
  });

  it('falls back to HTML when Text is empty', () => {
    const mox = createMoxPayload({ Text: '', HTML: '<p>html fallback</p>' });
    const result = transformMoxPayload(mox);

    expect(result.body).toBe('<p>html fallback</p>');
  });

  it('returns empty string when both Text and HTML are empty', () => {
    const mox = createMoxPayload({ Text: '', HTML: '' });
    const result = transformMoxPayload(mox);

    expect(result.body).toBe('');
  });

  it('falls back to Meta.MailFrom when From array is empty', () => {
    const mox = createMoxPayload({ From: [] });
    const result = transformMoxPayload(mox);

    expect(result.from).toBe('sender@example.com');
  });

  it('falls back to Meta.RcptTo when To array is empty', () => {
    const mox = createMoxPayload({ To: [] });
    const result = transformMoxPayload(mox);

    expect(result.to).toBe('alias@alias.id');
  });

  it('handles missing Subject gracefully', () => {
    const mox = createMoxPayload();
    (mox as any).Subject = undefined;
    const result = transformMoxPayload(mox);

    expect(result.subject).toBe('');
  });

  it('logs warning for attachment parts', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mox = createMoxPayload({
      Structure: {
        ContentType: 'multipart/mixed',
        ContentDisposition: '',
        Filename: '',
        DecodedSize: 0,
        Parts: [
          { ContentType: 'text/plain', ContentDisposition: '', Filename: '', DecodedSize: 15, Parts: [] },
          { ContentType: 'image/png', ContentDisposition: 'attachment', Filename: 'photo.png', DecodedSize: 45000, Parts: [] },
        ],
      },
    });

    transformMoxPayload(mox);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('has attachments'));
    warnSpy.mockRestore();
  });

  it('does not log warning when no attachment parts', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mox = createMoxPayload();
    transformMoxPayload(mox);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('detects non-text non-multipart parts as attachments', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mox = createMoxPayload({
      Structure: {
        ContentType: 'multipart/mixed',
        ContentDisposition: '',
        Filename: '',
        DecodedSize: 0,
        Parts: [
          { ContentType: 'text/plain', ContentDisposition: '', Filename: '', DecodedSize: 15, Parts: [] },
          { ContentType: 'application/pdf', ContentDisposition: '', Filename: 'doc.pdf', DecodedSize: 100000, Parts: [] },
        ],
      },
    });

    transformMoxPayload(mox);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('has attachments'));
    warnSpy.mockRestore();
  });
});

describe('POST /mox-webhook integration', () => {
  let ctx: BridgeContext;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createApp(ctx);
  });

  it('returns 200 with CID on valid Mox payload', async () => {
    const res = await request(app)
      .post('/mox-webhook')
      .set(authHeader())
      .send(createMoxPayload());

    expect(res.status).toBe(200);
    expect(res.body.cid).toBe('bafyreimockemailcid');
  });

  it('transforms Mox payload and processes through pipeline', async () => {
    await request(app)
      .post('/mox-webhook')
      .set(authHeader())
      .send(createMoxPayload());

    expect(ctx.ipfs.upload).toHaveBeenCalledTimes(1);
    expect(ctx.notificationQueue.enqueue).toHaveBeenCalledWith(
      'contract-address-abc',
      'bafyreimockmanifest',
    );
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(app)
      .post('/mox-webhook')
      .send(createMoxPayload());

    expect(res.status).toBe(401);
  });

  it('returns 403 with wrong webhook secret', async () => {
    const res = await request(app)
      .post('/mox-webhook')
      .set({ Authorization: 'Bearer wrong-secret' })
      .send(createMoxPayload());

    expect(res.status).toBe(403);
  });

  it('returns 400 on missing Meta.MsgID', async () => {
    const payload = createMoxPayload();
    (payload.Meta as any).MsgID = undefined;

    const res = await request(app)
      .post('/mox-webhook')
      .set(authHeader())
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid Mox webhook payload/);
  });

  it('returns 400 when both To array and Meta.RcptTo are missing', async () => {
    const payload = createMoxPayload({ To: [] });
    (payload.Meta as any).RcptTo = '';

    const res = await request(app)
      .post('/mox-webhook')
      .set(authHeader())
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid Mox webhook payload/);
  });

  it('accepts payload with To from Meta.RcptTo fallback', async () => {
    const payload = createMoxPayload({ To: [] });

    const res = await request(app)
      .post('/mox-webhook')
      .set(authHeader())
      .send(payload);

    expect(res.status).toBe(200);
  });

  it('returns 404 when alias not registered', async () => {
    vi.spyOn(ctx.aliasLookup, 'lookupAlias').mockResolvedValue(null);

    const res = await request(app)
      .post('/mox-webhook')
      .set(authHeader())
      .send(createMoxPayload());

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not registered/);
  });
});
