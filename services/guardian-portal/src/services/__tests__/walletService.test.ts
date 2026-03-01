import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectLaceWallet, connectWallet, disconnectWallet } from '../walletService';

describe('walletService', () => {
  afterEach(() => {
    // Clean up window.midnight
    delete (window as unknown as Record<string, unknown>).midnight;
  });

  describe('detectLaceWallet', () => {
    it('returns false when window.midnight is undefined', () => {
      delete (window as unknown as Record<string, unknown>).midnight;
      expect(detectLaceWallet()).toBe(false);
    });

    it('returns false when window.midnight exists but mnLace is missing', () => {
      (window as unknown as Record<string, unknown>).midnight = {};
      expect(detectLaceWallet()).toBe(false);
    });

    it('returns true when window.midnight.mnLace exists', () => {
      (window as unknown as Record<string, unknown>).midnight = { mnLace: {} };
      expect(detectLaceWallet()).toBe(true);
    });
  });

  describe('connectWallet', () => {
    it('throws when Lace wallet is not detected', async () => {
      delete (window as unknown as Record<string, unknown>).midnight;
      await expect(connectWallet('undeployed')).rejects.toThrow('Lace wallet not detected');
    });

    it('connects successfully and returns full WalletConnection with ConnectedAPI', async () => {
      const mockShieldedAddresses = {
        shieldedCoinPublicKey: 'coin_pub_key_hex',
        shieldedEncryptionPublicKey: 'enc_pub_key_hex',
      };
      const mockServiceConfig = {
        proverServerUri: 'http://localhost:6300',
        indexerUri: 'http://localhost:8088',
        indexerWsUri: 'ws://localhost:8088',
      };
      const mockConnectedAPI = {
        getShieldedAddresses: vi.fn().mockResolvedValue(mockShieldedAddresses),
        getConfiguration: vi.fn().mockResolvedValue(mockServiceConfig),
        balanceUnsealedTransaction: vi.fn(),
        submitTransaction: vi.fn(),
        getConnectionStatus: vi.fn(),
      };
      const mockLace = {
        connect: vi.fn().mockResolvedValue(mockConnectedAPI),
      };
      (window as unknown as Record<string, unknown>).midnight = { mnLace: mockLace };

      const result = await connectWallet('undeployed');

      expect(mockLace.connect).toHaveBeenCalledWith('undeployed');
      expect(mockConnectedAPI.getShieldedAddresses).toHaveBeenCalled();
      expect(mockConnectedAPI.getConfiguration).toHaveBeenCalled();
      expect(result.address).toBe('coin_pub_key_hex');
      expect(result.isConnected).toBe(true);
      expect(result.connectedAPI).toBe(mockConnectedAPI);
      expect(result.shieldedAddresses).toBe(mockShieldedAddresses);
      expect(result.serviceConfig).toBe(mockServiceConfig);
    });

    it('throws when no shielded address is available', async () => {
      const mockConnectedAPI = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedCoinPublicKey: '',
          shieldedEncryptionPublicKey: '',
        }),
        getConfiguration: vi.fn().mockResolvedValue({
          proverServerUri: '',
          indexerUri: '',
          indexerWsUri: '',
        }),
        balanceUnsealedTransaction: vi.fn(),
        submitTransaction: vi.fn(),
        getConnectionStatus: vi.fn(),
      };
      const mockLace = {
        connect: vi.fn().mockResolvedValue(mockConnectedAPI),
      };
      (window as unknown as Record<string, unknown>).midnight = { mnLace: mockLace };

      await expect(connectWallet('undeployed')).rejects.toThrow('No shielded address available');
    });

    it('throws when lace.connect() rejects', async () => {
      const mockLace = {
        connect: vi.fn().mockRejectedValue(new Error('User rejected connection')),
      };
      (window as unknown as Record<string, unknown>).midnight = { mnLace: mockLace };

      await expect(connectWallet('undeployed')).rejects.toThrow('User rejected connection');
    });

    it('returns serviceConfig with proverServerUri from getConfiguration()', async () => {
      const mockConnectedAPI = {
        getShieldedAddresses: vi.fn().mockResolvedValue({
          shieldedCoinPublicKey: 'some_key',
          shieldedEncryptionPublicKey: 'some_enc_key',
        }),
        getConfiguration: vi.fn().mockResolvedValue({
          proverServerUri: 'http://proof.example.com:6300',
          indexerUri: 'http://indexer.example.com:8088',
          indexerWsUri: 'ws://indexer.example.com:8088',
        }),
        balanceUnsealedTransaction: vi.fn(),
        submitTransaction: vi.fn(),
        getConnectionStatus: vi.fn(),
      };
      const mockLace = {
        connect: vi.fn().mockResolvedValue(mockConnectedAPI),
      };
      (window as unknown as Record<string, unknown>).midnight = { mnLace: mockLace };

      const result = await connectWallet('preprod');

      expect(result.serviceConfig.proverServerUri).toBe('http://proof.example.com:6300');
      expect(result.serviceConfig.indexerUri).toBe('http://indexer.example.com:8088');
      expect(result.serviceConfig.indexerWsUri).toBe('ws://indexer.example.com:8088');
    });
  });

  describe('disconnectWallet', () => {
    it('does not throw', () => {
      expect(() => disconnectWallet()).not.toThrow();
    });
  });
});
