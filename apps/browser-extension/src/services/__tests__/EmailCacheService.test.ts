import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome.storage.local
const storageData: Record<string, unknown> = {};
const mockGet = vi.fn((keys: string | string[]) => {
  const result: Record<string, unknown> = {};
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    if (key in storageData) {
      result[key] = storageData[key];
    }
  }
  return Promise.resolve(result);
});
const mockSet = vi.fn((items: Record<string, unknown>) => {
  Object.assign(storageData, items);
  return Promise.resolve();
});
const mockRemove = vi.fn((keys: string | string[]) => {
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    delete storageData[key];
  }
  return Promise.resolve();
});

// Global chrome mock
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: mockGet,
      set: mockSet,
      remove: mockRemove,
    },
  },
});

import {
  EmailCacheService,
  CachedEmail,
} from '../EmailCacheService';

const SAMPLE_EMAIL: CachedEmail = {
  cid: 'bafyreiabc123test1',
  from: 'sender@example.com',
  to: 'alias@alias.id',
  subject: 'Test email',
  bodyPreview: 'Hello from the blockchain!',
  receivedAt: 1709553600,
  isRead: false,
  cachedAt: 1709554000,
};

const SAMPLE_EMAIL_2: CachedEmail = {
  cid: 'bafyreiabc123test2',
  from: 'other@example.com',
  to: 'alias@alias.id',
  subject: 'Second email',
  bodyPreview: 'Another message.',
  receivedAt: 1709554200,
  isRead: true,
  cachedAt: 1709554500,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Clear storage
  for (const key of Object.keys(storageData)) {
    delete storageData[key];
  }
});

describe('EmailCacheService', () => {
  const cache = new EmailCacheService();

  describe('cacheEmail', () => {
    it('stores email metadata in chrome.storage.local', async () => {
      await cache.cacheEmail(SAMPLE_EMAIL);

      expect(mockSet).toHaveBeenCalledWith({
        [`emailCache:${SAMPLE_EMAIL.cid}`]: SAMPLE_EMAIL,
      });
    });
  });

  describe('getCachedEmails', () => {
    it('returns empty array when no emails cached', async () => {
      const result = await cache.getCachedEmails();
      expect(result).toEqual([]);
    });

    it('returns all cached email metadata', async () => {
      // Pre-populate storage
      storageData[`emailCache:${SAMPLE_EMAIL.cid}`] = SAMPLE_EMAIL;
      storageData[`emailCache:${SAMPLE_EMAIL_2.cid}`] = SAMPLE_EMAIL_2;
      storageData['emailCacheIndex'] = [SAMPLE_EMAIL.cid, SAMPLE_EMAIL_2.cid];

      const result = await cache.getCachedEmails();
      expect(result).toHaveLength(2);
    });
  });

  describe('markAsRead', () => {
    it('updates isRead flag to true', async () => {
      storageData[`emailCache:${SAMPLE_EMAIL.cid}`] = { ...SAMPLE_EMAIL };

      await cache.markAsRead(SAMPLE_EMAIL.cid);

      expect(mockSet).toHaveBeenCalledWith({
        [`emailCache:${SAMPLE_EMAIL.cid}`]: expect.objectContaining({ isRead: true }),
      });
    });

    it('does nothing if email not in cache', async () => {
      await cache.markAsRead('nonexistent-cid');
      // set should not be called for the email key
      expect(mockSet).not.toHaveBeenCalled();
    });
  });

  describe('deleteEmail', () => {
    it('removes email from cache', async () => {
      storageData['emailCacheIndex'] = [SAMPLE_EMAIL.cid, SAMPLE_EMAIL_2.cid];
      storageData[`emailCache:${SAMPLE_EMAIL.cid}`] = SAMPLE_EMAIL;

      await cache.deleteEmail(SAMPLE_EMAIL.cid);

      expect(mockRemove).toHaveBeenCalledWith(`emailCache:${SAMPLE_EMAIL.cid}`);
    });
  });

  describe('getKnownCids', () => {
    it('returns empty set when no emails cached', async () => {
      const result = await cache.getKnownCids();
      expect(result).toEqual(new Set());
    });

    it('returns set of all cached CIDs', async () => {
      storageData['emailCacheIndex'] = [SAMPLE_EMAIL.cid, SAMPLE_EMAIL_2.cid];

      const result = await cache.getKnownCids();
      expect(result).toEqual(new Set([SAMPLE_EMAIL.cid, SAMPLE_EMAIL_2.cid]));
    });
  });

  describe('saveManifestCache', () => {
    it('stores manifest metadata', async () => {
      await cache.saveManifestCache('bafymanifest123', [SAMPLE_EMAIL.cid]);

      expect(mockSet).toHaveBeenCalledWith({
        emailManifestCache: {
          manifestCid: 'bafymanifest123',
          emailCids: [SAMPLE_EMAIL.cid],
          lastChecked: expect.any(Number),
        },
      });
    });
  });

  describe('getManifestCache', () => {
    it('returns null when no manifest cached', async () => {
      const result = await cache.getManifestCache();
      expect(result).toBeNull();
    });

    it('returns cached manifest metadata', async () => {
      const manifestCache = {
        manifestCid: 'bafymanifest123',
        emailCids: [SAMPLE_EMAIL.cid],
        lastChecked: Date.now(),
      };
      storageData['emailManifestCache'] = manifestCache;

      const result = await cache.getManifestCache();
      expect(result).toEqual(manifestCache);
    });
  });

  describe('cacheFullBody', () => {
    it('stores full decrypted email under emailBody: key', async () => {
      const fullEmail = {
        from: 'sender@example.com',
        to: 'alias@alias.id',
        subject: 'Test',
        body: 'Full body text here',
        attachments: [{ name: 'file.txt', contentType: 'text/plain', base64: 'aGVsbG8=' }],
        receivedAt: 1709553600,
      };

      await cache.cacheFullBody(SAMPLE_EMAIL.cid, fullEmail);

      expect(mockSet).toHaveBeenCalledWith({
        [`emailBody:${SAMPLE_EMAIL.cid}`]: fullEmail,
      });
    });
  });

  describe('getCachedFullBody', () => {
    it('returns null when no full body cached', async () => {
      const result = await cache.getCachedFullBody('nonexistent-cid');
      expect(result).toBeNull();
    });

    it('returns cached full body when available', async () => {
      const fullEmail = {
        from: 'sender@example.com',
        to: 'alias@alias.id',
        subject: 'Test',
        body: 'Full body text here',
        attachments: [],
        receivedAt: 1709553600,
      };
      storageData[`emailBody:${SAMPLE_EMAIL.cid}`] = fullEmail;

      const result = await cache.getCachedFullBody(SAMPLE_EMAIL.cid);
      expect(result).toEqual(fullEmail);
    });
  });

  describe('deleteEmail with full body', () => {
    it('removes both metadata and full body from cache', async () => {
      storageData['emailCacheIndex'] = [SAMPLE_EMAIL.cid];
      storageData[`emailCache:${SAMPLE_EMAIL.cid}`] = SAMPLE_EMAIL;
      storageData[`emailBody:${SAMPLE_EMAIL.cid}`] = { body: 'test' };

      await cache.deleteEmail(SAMPLE_EMAIL.cid);

      // Should remove both keys
      expect(mockRemove).toHaveBeenCalledWith(`emailCache:${SAMPLE_EMAIL.cid}`);
      expect(mockRemove).toHaveBeenCalledWith(`emailBody:${SAMPLE_EMAIL.cid}`);
    });
  });
});
