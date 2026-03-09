import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import nacl from 'tweetnacl';
import { createApp } from '../app.js';
import { EmailEncryptor } from '../services/emailEncryptor.js';
import { ManifestManager } from '../services/manifestManager.js';
import { NotificationQueue } from '../services/notificationQueue.js';
import { AliasLookupService } from '../services/aliasLookup.js';
import { EmailKeyLookupService } from '../services/emailKeyLookup.js';
import type { BridgeContext } from '../types/context.js';

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

describe('POST /receive-email integration', () => {
  let ctx: BridgeContext;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    ctx = createMockContext();
    app = createApp(ctx);
  });

  it('returns 200 with CID on success', async () => {
    const res = await request(app)
      .post('/receive-email')
      .set(authHeader())
      .send({
        to: 'zk-tiger-1234@alias.id',
        from: 'sender@example.com',
        subject: 'Hello',
        body: 'World',
      });

    expect(res.status).toBe(200);
    expect(res.body.cid).toBe('bafyreimockemailcid');
  });

  it('encrypts email and uploads to IPFS', async () => {
    await request(app)
      .post('/receive-email')
      .set(authHeader())
      .send({
        to: 'zk-tiger-1234@alias.id',
        from: 'sender@example.com',
        subject: 'Hello',
        body: 'World',
      });

    // IPFS upload called with encrypted bytes
    expect(ctx.ipfs.upload).toHaveBeenCalledTimes(1);
    const uploadedData = (ctx.ipfs.upload as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(uploadedData).toBeInstanceOf(Uint8Array);
    expect(uploadedData.length).toBeGreaterThan(56); // overhead
  });

  it('reads existing manifest CID from indexer before appending', async () => {
    await request(app)
      .post('/receive-email')
      .set(authHeader())
      .send({
        to: 'zk-tiger-1234@alias.id',
        from: 'sender@example.com',
        subject: 'Hello',
        body: 'World',
      });

    // Verify readInboxManifestCid was called with the contract address
    expect(ctx.readInboxManifestCid).toHaveBeenCalledWith('contract-address-abc');

    // Verify appendAndUpload received the existing manifest CID (not null)
    expect(ctx.manifestManager.appendAndUpload).toHaveBeenCalledWith(
      'bafyreiexistingmanifest',
      'bafyreimockemailcid',
    );
  });

  it('queues notification with manifest CID', async () => {
    await request(app)
      .post('/receive-email')
      .set(authHeader())
      .send({
        to: 'zk-tiger-1234@alias.id',
        from: 'sender@example.com',
        subject: 'Hello',
        body: 'World',
      });

    expect(ctx.notificationQueue.enqueue).toHaveBeenCalledWith(
      'contract-address-abc',
      'bafyreimockmanifest',
    );
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(app)
      .post('/receive-email')
      .send({
        to: 'zk-tiger-1234@alias.id',
        from: 'sender@example.com',
        subject: 'Hello',
        body: 'World',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing or invalid Authorization/);
  });

  it('returns 403 with wrong webhook secret', async () => {
    const res = await request(app)
      .post('/receive-email')
      .set({ Authorization: 'Bearer wrong-secret' })
      .send({
        to: 'zk-tiger-1234@alias.id',
        from: 'sender@example.com',
        subject: 'Hello',
        body: 'World',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Invalid webhook secret/);
  });

  it('returns 400 on missing required fields', async () => {
    const res = await request(app)
      .post('/receive-email')
      .set(authHeader())
      .send({ to: 'test@alias.id' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing required fields/);
  });

  it('returns 400 on invalid "to" format', async () => {
    const res = await request(app)
      .post('/receive-email')
      .set(authHeader())
      .send({
        to: 'not-an-email',
        from: 'sender@example.com',
        subject: 'Hi',
        body: 'Body',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid "to" address/);
  });

  it('returns 404 when alias not registered', async () => {
    vi.spyOn(ctx.aliasLookup, 'lookupAlias').mockResolvedValue(null);

    const res = await request(app)
      .post('/receive-email')
      .set(authHeader())
      .send({
        to: 'unknown@alias.id',
        from: 'sender@example.com',
        subject: 'Hi',
        body: 'Body',
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not registered/);
  });

  it('returns 404 when recipient has no email public key', async () => {
    vi.spyOn(ctx.emailKeyLookup, 'getEmailPublicKey').mockResolvedValue(null);

    const res = await request(app)
      .post('/receive-email')
      .set(authHeader())
      .send({
        to: 'nokey@alias.id',
        from: 'sender@example.com',
        subject: 'Hi',
        body: 'Body',
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no email public key/);
  });

  it('returns 200 for GET /health with indexer status', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.walletReady).toBe(true);
    expect(res.body.indexerConnected).toBe(true);
  });

  it('returns degraded health when indexer is unreachable', async () => {
    (ctx.checkIndexerHealth as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.indexerConnected).toBe(false);
  });

  it('extracts local part from bracketed email format', async () => {
    const lookupSpy = vi.spyOn(ctx.aliasLookup, 'lookupAlias');

    await request(app)
      .post('/receive-email')
      .set(authHeader())
      .send({
        to: 'Alias Name <zk-fox-5678@alias.id>',
        from: 'sender@example.com',
        subject: 'Hi',
        body: 'Body',
      });

    expect(lookupSpy).toHaveBeenCalledWith('zk-fox-5678');
  });
});
