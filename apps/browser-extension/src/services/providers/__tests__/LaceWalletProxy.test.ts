import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock wxt/utils/storage before imports
vi.mock('wxt/utils/storage', () => ({
  storage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

// Mock SDK packages — inline factories (no top-level variable references)
vi.mock('@midnight-ntwrk/compact-runtime', () => ({
  toHex: vi.fn((bytes: Uint8Array) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')),
  fromHex: vi.fn((hex: string) => new Uint8Array((hex.match(/.{2}/g) || []).map(h => parseInt(h, 16)))),
}));

vi.mock('@midnight-ntwrk/ledger-v8', () => ({
  Transaction: {
    deserialize: vi.fn().mockReturnValue({ __type: 'FinalizedTransaction' }),
  },
}));

// Mock chrome.scripting
const mockExecuteScript = vi.fn();
vi.stubGlobal('chrome', {
  scripting: { executeScript: mockExecuteScript },
  runtime: { getURL: vi.fn((p: string) => `chrome-extension://ext-id/${p}`) },
});

import { LaceWalletProxy } from '../LaceWalletProxy';
import { storage } from 'wxt/utils/storage';
import { toHex, fromHex } from '@midnight-ntwrk/compact-runtime';
import { Transaction } from '@midnight-ntwrk/ledger-v8';

const MOCK_WALLET_STATE = {
  coinPublicKey: 'coin-pub-key-hex',
  encryptionPublicKey: 'enc-pub-key-hex',
  shieldedAddress: 'shielded-addr-hex',
  unshieldedAddress: 'unshielded-addr-hex',
  activeTabId: 42,
  networkId: 'preprod',
};

describe('LaceWalletProxy', () => {
  let proxy: LaceWalletProxy;

  beforeEach(() => {
    vi.clearAllMocks();
    proxy = new LaceWalletProxy();
    (storage.getItem as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_WALLET_STATE);
    // Reset Transaction.deserialize mock for each test
    (Transaction.deserialize as ReturnType<typeof vi.fn>).mockReturnValue({ __type: 'FinalizedTransaction' });
  });

  describe('getCoinPublicKey', () => {
    it('returns cached coinPublicKey from wallet state', async () => {
      const result = await proxy.getCoinPublicKey();
      expect(result).toBe('coin-pub-key-hex');
    });

    it('throws if no wallet state available', async () => {
      (storage.getItem as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      await expect(proxy.getCoinPublicKey()).rejects.toThrow('Lace wallet not connected');
    });
  });

  describe('getEncryptionPublicKey', () => {
    it('returns cached encryptionPublicKey from wallet state', async () => {
      const result = await proxy.getEncryptionPublicKey();
      expect(result).toBe('enc-pub-key-hex');
    });
  });

  describe('balanceTx', () => {
    it('serializes tx, sends to Lace, validates hex, deserializes to FinalizedTransaction', async () => {
      const mockTx = {
        serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA, 0xBB])),
      };

      const balancedHex = 'deadbeef01020304';
      mockExecuteScript.mockResolvedValue([{ result: { hex: balancedHex } }]);

      const result = await proxy.balanceTx(mockTx);

      // Verify executeScript targets the stored tab ID (H1: not active tab)
      expect(mockExecuteScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 42 },
          world: 'MAIN',
        })
      );

      // Verify SDK toHex was called to serialize the tx
      expect(toHex).toHaveBeenCalledWith(new Uint8Array([0xAA, 0xBB]));

      // Verify SDK fromHex was called with the response hex
      expect(fromHex).toHaveBeenCalledWith(balancedHex);

      // Verify Transaction.deserialize was called with correct args
      expect(Transaction.deserialize).toHaveBeenCalledWith(
        'signature', 'proof', 'binding',
        expect.any(Uint8Array),
      );

      // Result should be the deserialized FinalizedTransaction
      expect(result).toEqual({ __type: 'FinalizedTransaction' });
    });

    it('throws on empty response from page context', async () => {
      const mockTx = { serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA])) };
      mockExecuteScript.mockResolvedValue([{ result: null }]);

      await expect(proxy.balanceTx(mockTx)).rejects.toThrow('No response from Lace wallet');
    });

    it('throws on error response from page context', async () => {
      const mockTx = { serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA])) };
      mockExecuteScript.mockResolvedValue([{ result: { __error: 'User rejected' } }]);

      await expect(proxy.balanceTx(mockTx)).rejects.toThrow('User rejected');
    });

    it('throws when response hex is invalid (H2 validation)', async () => {
      const mockTx = { serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA])) };
      mockExecuteScript.mockResolvedValue([{ result: { hex: 'not-valid-hex!' } }]);

      await expect(proxy.balanceTx(mockTx)).rejects.toThrow('Invalid hex');
    });

    it('throws when response hex is empty (H2 validation)', async () => {
      const mockTx = { serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA])) };
      mockExecuteScript.mockResolvedValue([{ result: { hex: '' } }]);

      await expect(proxy.balanceTx(mockTx)).rejects.toThrow('Empty response');
    });

    it('throws when wallet tab is not available', async () => {
      const mockTx = { serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA])) };
      mockExecuteScript.mockRejectedValue(new Error('No tab with id: 42'));

      await expect(proxy.balanceTx(mockTx)).rejects.toThrow(
        'Wallet tab no longer available'
      );
    });

    it('throws on deserialization failure', async () => {
      const mockTx = { serialize: vi.fn().mockReturnValue(new Uint8Array([0xAA])) };
      mockExecuteScript.mockResolvedValue([{ result: { hex: 'aabb' } }]);
      (Transaction.deserialize as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('corrupt data');
      });

      await expect(proxy.balanceTx(mockTx)).rejects.toThrow('Failed to deserialize');
    });
  });
});
