import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock wxt/utils/storage before imports
vi.mock('wxt/utils/storage', () => ({
  storage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

// Mock SDK packages — inline factory (no top-level variable references)
vi.mock('@midnight-ntwrk/compact-runtime', () => ({
  toHex: vi.fn((bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')),
}));

// Mock chrome.scripting
const mockExecuteScript = vi.fn();
vi.stubGlobal('chrome', {
  scripting: { executeScript: mockExecuteScript },
  runtime: { getURL: vi.fn((p: string) => `chrome-extension://ext-id/${p}`) },
});

import { LaceMidnightProxy } from '../LaceMidnightProxy';
import { storage } from 'wxt/utils/storage';
import { toHex } from '@midnight-ntwrk/compact-runtime';

const MOCK_WALLET_STATE = {
  coinPublicKey: 'coin-pub-key-hex',
  encryptionPublicKey: 'enc-pub-key-hex',
  shieldedAddress: 'shielded-addr-hex',
  unshieldedAddress: 'unshielded-addr-hex',
  activeTabId: 42,
  networkId: 'preprod',
};

describe('LaceMidnightProxy', () => {
  let proxy: LaceMidnightProxy;

  beforeEach(() => {
    vi.clearAllMocks();
    proxy = new LaceMidnightProxy();
    (storage.getItem as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_WALLET_STATE);
  });

  describe('submitTx', () => {
    it('serializes tx, sends to Lace, extracts txId from tx.identifiers()', async () => {
      const mockTx = {
        serialize: vi.fn().mockReturnValue(new Uint8Array([0xCC, 0xDD])),
        identifiers: vi.fn().mockReturnValue(['tx-hash-abc123']),
      };

      mockExecuteScript.mockResolvedValue([{ result: { success: true } }]);

      const result = await proxy.submitTx(mockTx);

      expect(mockExecuteScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 42 },
          world: 'MAIN',
        })
      );
      expect(toHex).toHaveBeenCalledWith(new Uint8Array([0xCC, 0xDD]));
      expect(mockTx.identifiers).toHaveBeenCalled();
      expect(result).toBe('tx-hash-abc123');
    });

    it('throws on empty response', async () => {
      const mockTx = {
        serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA])),
        identifiers: vi.fn(),
      };
      mockExecuteScript.mockResolvedValue([{ result: null }]);

      await expect(proxy.submitTx(mockTx)).rejects.toThrow('No response from Lace wallet');
    });

    it('throws on error response', async () => {
      const mockTx = {
        serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA])),
        identifiers: vi.fn(),
      };
      mockExecuteScript.mockResolvedValue([{ result: { __error: 'Transaction rejected' } }]);

      await expect(proxy.submitTx(mockTx)).rejects.toThrow('Transaction rejected');
    });

    it('throws when wallet tab is not available', async () => {
      const mockTx = {
        serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA])),
        identifiers: vi.fn(),
      };
      mockExecuteScript.mockRejectedValue(new Error('No tab with id: 42'));

      await expect(proxy.submitTx(mockTx)).rejects.toThrow(
        'Wallet tab no longer available'
      );
    });

    it('throws if no wallet state', async () => {
      (storage.getItem as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const mockTx = {
        serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA])),
        identifiers: vi.fn(),
      };

      await expect(proxy.submitTx(mockTx)).rejects.toThrow('Lace wallet not connected');
    });

    it('throws if tx.identifiers() returns empty array', async () => {
      const mockTx = {
        serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA])),
        identifiers: vi.fn().mockReturnValue([]),
      };
      mockExecuteScript.mockResolvedValue([{ result: { success: true } }]);

      await expect(proxy.submitTx(mockTx)).rejects.toThrow('No transaction identifier');
    });
  });
});
