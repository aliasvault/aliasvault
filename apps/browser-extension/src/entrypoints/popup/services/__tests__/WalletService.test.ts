import { describe, it, expect, vi } from 'vitest';

// Pin CURRENT_NETWORK to 'undeployed' regardless of VITE_MIDNIGHT_NETWORK env var
// so these tests remain deterministic across local dev setups.
vi.mock('@/entrypoints/popup/config/networkConfig', async () => {
  const actual = await vi.importActual<typeof import('@/entrypoints/popup/config/networkConfig')>(
    '@/entrypoints/popup/config/networkConfig',
  );
  return {
    ...actual,
    CURRENT_NETWORK: 'undeployed',
  };
});

import {
  getNetworkId,
  createInitialAuthState,
  createAuthenticatedState,
  isAuthenticated,
} from '../WalletService';
import type { WalletAuthState } from '../WalletService';

describe('WalletService', () => {
  describe('getNetworkId', () => {
    it('returns a non-empty string', () => {
      expect(getNetworkId()).toBeTruthy();
      expect(typeof getNetworkId()).toBe('string');
    });

    it('returns undeployed for local dev', () => {
      expect(getNetworkId()).toBe('undeployed');
    });
  });

  describe('createInitialAuthState', () => {
    it('returns unauthenticated state', () => {
      const state = createInitialAuthState();
      expect(state.isConnected).toBe(false);
      expect(state.isVerified).toBe(false);
      expect(state.walletAddress).toBeNull();
      expect(state.networkId).toBe('undeployed');
    });
  });

  describe('createAuthenticatedState', () => {
    it('returns fully authenticated state with address', () => {
      const address = '0xabc123def456';
      const state = createAuthenticatedState(address);
      expect(state.isConnected).toBe(true);
      expect(state.isVerified).toBe(true);
      expect(state.walletAddress).toBe(address);
      expect(state.networkId).toBe('undeployed');
    });
  });

  describe('isAuthenticated', () => {
    it('returns true for fully authenticated state', () => {
      const state = createAuthenticatedState('0xabc');
      expect(isAuthenticated(state)).toBe(true);
    });

    it('returns false for initial state', () => {
      const state = createInitialAuthState();
      expect(isAuthenticated(state)).toBe(false);
    });

    it('returns false if connected but not verified', () => {
      const state: WalletAuthState = {
        isConnected: true,
        isVerified: false,
        walletAddress: '0xabc',
        networkId: 'undeployed',
      };
      expect(isAuthenticated(state)).toBe(false);
    });

    it('returns false if verified but no wallet address', () => {
      const state: WalletAuthState = {
        isConnected: true,
        isVerified: true,
        walletAddress: null,
        networkId: 'undeployed',
      };
      expect(isAuthenticated(state)).toBe(false);
    });

    it('returns false if not connected', () => {
      const state: WalletAuthState = {
        isConnected: false,
        isVerified: true,
        walletAddress: '0xabc',
        networkId: 'undeployed',
      };
      expect(isAuthenticated(state)).toBe(false);
    });
  });
});
