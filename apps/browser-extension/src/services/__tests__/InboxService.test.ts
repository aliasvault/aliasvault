import { describe, it, expect, vi, beforeEach } from 'vitest';
import nacl from 'tweetnacl';

// Mock PinataBrowserProvider
const mockDownload = vi.fn();
vi.mock('../PinataBrowserProvider', () => ({
  PinataBrowserProvider: vi.fn(() => ({
    download: mockDownload,
  })),
}));

// Mock MidnightContractService
const mockReadInboxManifestCid = vi.fn();
const mockReadEmailCount = vi.fn();
vi.mock('../MidnightContractService', () => ({
  MidnightContractService: vi.fn(() => ({
    readInboxManifestCid: mockReadInboxManifestCid,
    readEmailCount: mockReadEmailCount,
  })),
}));

import {
  InboxService,
  InboxManifest,
  fetchManifest,
  getNewEmailCids,
  assertInboxCIDv1,
} from '../InboxService';

const VALID_CID_1 = 'bafyreiabc123test1';
const VALID_CID_2 = 'bafyreiabc123test2';
const VALID_CID_3 = 'bafkreiabc123test3';
const VALID_MANIFEST_CID = 'bafyreiabc123manifest';

const SAMPLE_MANIFEST: InboxManifest = {
  version: 1,
  emails: [
    { cid: VALID_CID_1, ts: 1709553600 },
    { cid: VALID_CID_2, ts: 1709554200 },
  ],
};

describe('assertInboxCIDv1', () => {
  it('accepts valid CIDv1 starting with bafy', () => {
    expect(() => assertInboxCIDv1('bafyreiabc123')).not.toThrow();
  });

  it('accepts valid CIDv1 starting with bafk', () => {
    expect(() => assertInboxCIDv1('bafkreiabc123')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => assertInboxCIDv1('')).toThrow();
  });

  it('rejects CIDv0', () => {
    expect(() => assertInboxCIDv1('QmTest123')).toThrow();
  });
});

describe('fetchManifest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a valid manifest JSON', async () => {
    const manifestBytes = new TextEncoder().encode(JSON.stringify(SAMPLE_MANIFEST));
    mockDownload.mockResolvedValue(manifestBytes);

    const pinata = { download: mockDownload } as any;
    const result = await fetchManifest(pinata, VALID_MANIFEST_CID);

    expect(result.version).toBe(1);
    expect(result.emails).toHaveLength(2);
    expect(result.emails[0].cid).toBe(VALID_CID_1);
    expect(result.emails[1].ts).toBe(1709554200);
  });

  it('throws on invalid manifest JSON', async () => {
    mockDownload.mockResolvedValue(new TextEncoder().encode('not json'));

    const pinata = { download: mockDownload } as any;
    await expect(fetchManifest(pinata, VALID_MANIFEST_CID)).rejects.toThrow();
  });

  it('throws on manifest with missing version', async () => {
    const badManifest = { emails: [] };
    mockDownload.mockResolvedValue(new TextEncoder().encode(JSON.stringify(badManifest)));

    const pinata = { download: mockDownload } as any;
    await expect(fetchManifest(pinata, VALID_MANIFEST_CID)).rejects.toThrow('Invalid manifest');
  });

  it('throws on manifest with missing emails array', async () => {
    const badManifest = { version: 1 };
    mockDownload.mockResolvedValue(new TextEncoder().encode(JSON.stringify(badManifest)));

    const pinata = { download: mockDownload } as any;
    await expect(fetchManifest(pinata, VALID_MANIFEST_CID)).rejects.toThrow('Invalid manifest');
  });
});

describe('getNewEmailCids', () => {
  it('returns all CIDs when cache is empty', () => {
    const cachedCids = new Set<string>();
    const result = getNewEmailCids(SAMPLE_MANIFEST, cachedCids);

    expect(result).toEqual([VALID_CID_1, VALID_CID_2]);
  });

  it('returns only new CIDs not in cache', () => {
    const cachedCids = new Set([VALID_CID_1]);
    const result = getNewEmailCids(SAMPLE_MANIFEST, cachedCids);

    expect(result).toEqual([VALID_CID_2]);
  });

  it('returns empty array when all CIDs are cached', () => {
    const cachedCids = new Set([VALID_CID_1, VALID_CID_2]);
    const result = getNewEmailCids(SAMPLE_MANIFEST, cachedCids);

    expect(result).toEqual([]);
  });

  it('handles manifest with empty emails array', () => {
    const emptyManifest: InboxManifest = { version: 1, emails: [] };
    const result = getNewEmailCids(emptyManifest, new Set());

    expect(result).toEqual([]);
  });
});
