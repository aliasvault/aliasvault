import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManifestManager } from '../services/manifestManager.js';
import type { InboxManifest } from '../types/email.js';

function createMockIpfs() {
  return {
    upload: vi.fn<(data: Uint8Array) => Promise<string>>().mockResolvedValue('bafyreimock123'),
    download: vi.fn<(cid: string) => Promise<Uint8Array>>(),
  };
}

describe('ManifestManager', () => {
  let mockIpfs: ReturnType<typeof createMockIpfs>;
  let manager: ManifestManager;

  beforeEach(() => {
    mockIpfs = createMockIpfs();
    manager = new ManifestManager(mockIpfs as any);
  });

  describe('createManifest', () => {
    it('creates an empty manifest with version 1', () => {
      const manifest = manager.createManifest();
      expect(manifest).toEqual({ version: 1, emails: [] });
    });
  });

  describe('appendEntry', () => {
    it('appends entry without mutating original', () => {
      const original: InboxManifest = { version: 1, emails: [] };
      const entry = { cid: 'bafyrei123', ts: 1709553600 };

      const updated = manager.appendEntry(original, entry);

      expect(updated.emails).toHaveLength(1);
      expect(updated.emails[0]).toEqual(entry);
      expect(original.emails).toHaveLength(0); // immutable
    });

    it('appends to existing entries', () => {
      const original: InboxManifest = {
        version: 1,
        emails: [{ cid: 'bafyrei111', ts: 1709553000 }],
      };
      const entry = { cid: 'bafyrei222', ts: 1709554000 };

      const updated = manager.appendEntry(original, entry);

      expect(updated.emails).toHaveLength(2);
      expect(updated.emails[1]).toEqual(entry);
    });
  });

  describe('serialize / deserialize', () => {
    it('round-trips a manifest', () => {
      const manifest: InboxManifest = {
        version: 1,
        emails: [
          { cid: 'bafyrei111', ts: 1709553000 },
          { cid: 'bafyrei222', ts: 1709554000 },
        ],
      };

      const bytes = manager.serialize(manifest);
      const restored = manager.deserialize(bytes);

      expect(restored).toEqual(manifest);
    });

    it('throws on invalid format (wrong version)', () => {
      const bad = new TextEncoder().encode(JSON.stringify({ version: 2, emails: [] }));
      expect(() => manager.deserialize(bad)).toThrow('Invalid manifest format');
    });

    it('throws on invalid format (no emails array)', () => {
      const bad = new TextEncoder().encode(JSON.stringify({ version: 1 }));
      expect(() => manager.deserialize(bad)).toThrow('Invalid manifest format');
    });

    it('throws on invalid JSON', () => {
      const bad = new TextEncoder().encode('not json');
      expect(() => manager.deserialize(bad)).toThrow();
    });
  });

  describe('fetchOrCreate', () => {
    it('creates new manifest when CID is null', async () => {
      const manifest = await manager.fetchOrCreate(null);
      expect(manifest).toEqual({ version: 1, emails: [] });
      expect(mockIpfs.download).not.toHaveBeenCalled();
    });

    it('creates new manifest when CID is empty string', async () => {
      const manifest = await manager.fetchOrCreate('');
      expect(manifest).toEqual({ version: 1, emails: [] });
    });

    it('downloads and parses existing manifest', async () => {
      const existing: InboxManifest = {
        version: 1,
        emails: [{ cid: 'bafyrei111', ts: 1709553000 }],
      };
      mockIpfs.download.mockResolvedValue(new TextEncoder().encode(JSON.stringify(existing)));

      const manifest = await manager.fetchOrCreate('bafyreiexisting');

      expect(mockIpfs.download).toHaveBeenCalledWith('bafyreiexisting');
      expect(manifest).toEqual(existing);
    });
  });

  describe('upload', () => {
    it('serializes and uploads manifest', async () => {
      const manifest: InboxManifest = {
        version: 1,
        emails: [{ cid: 'bafyrei111', ts: 1709553000 }],
      };

      const cid = await manager.upload(manifest);

      expect(cid).toBe('bafyreimock123');
      expect(mockIpfs.upload).toHaveBeenCalledTimes(1);
      const uploadedData = mockIpfs.upload.mock.calls[0][0];
      const parsed = JSON.parse(new TextDecoder().decode(uploadedData));
      expect(parsed).toEqual(manifest);
    });
  });

  describe('appendAndUpload', () => {
    it('creates manifest, appends, and uploads when no existing CID', async () => {
      const cid = await manager.appendAndUpload(null, 'bafyreinewmail');

      expect(cid).toBe('bafyreimock123');
      expect(mockIpfs.upload).toHaveBeenCalledTimes(1);

      const uploadedData = mockIpfs.upload.mock.calls[0][0];
      const parsed = JSON.parse(new TextDecoder().decode(uploadedData));
      expect(parsed.version).toBe(1);
      expect(parsed.emails).toHaveLength(1);
      expect(parsed.emails[0].cid).toBe('bafyreinewmail');
      expect(typeof parsed.emails[0].ts).toBe('number');
    });
  });
});
