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

    it('connects successfully and returns address', async () => {
      const mockAddress = 'addr_test1qz0x7nqc4hdz';
      const mockWallet = {
        getShieldedAddresses: vi.fn().mockResolvedValue([mockAddress]),
      };
      const mockLace = {
        connect: vi.fn().mockResolvedValue(mockWallet),
      };
      (window as unknown as Record<string, unknown>).midnight = { mnLace: mockLace };

      const result = await connectWallet('undeployed');

      expect(mockLace.connect).toHaveBeenCalledWith('undeployed');
      expect(mockWallet.getShieldedAddresses).toHaveBeenCalled();
      expect(result).toEqual({ address: mockAddress, isConnected: true });
    });

    it('throws when no shielded address is available', async () => {
      const mockWallet = {
        getShieldedAddresses: vi.fn().mockResolvedValue([]),
      };
      const mockLace = {
        connect: vi.fn().mockResolvedValue(mockWallet),
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
  });

  describe('disconnectWallet', () => {
    it('does not throw', () => {
      expect(() => disconnectWallet()).not.toThrow();
    });
  });
});
