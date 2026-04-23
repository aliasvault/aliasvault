import { describe, it, expect, vi } from 'vitest';

// Pin CURRENT_NETWORK to 'undeployed' regardless of VITE_MIDNIGHT_NETWORK env var
// so these tests remain deterministic across local dev setups.
vi.mock('../networkConfig', async () => {
  const actual = await vi.importActual<typeof import('../networkConfig')>('../networkConfig');
  return {
    ...actual,
    CURRENT_NETWORK: 'undeployed',
  };
});

import {
  getExplorerConfig,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  getExplorerContractUrl,
} from '../explorerConfig';

describe('explorerConfig', () => {
  describe('getExplorerConfig', () => {
    it('returns null for undeployed network (current default)', () => {
      // CURRENT_NETWORK is 'undeployed' which has no explorer
      const config = getExplorerConfig();
      expect(config).toBeNull();
    });
  });

  describe('getExplorerAddressUrl', () => {
    it('returns null when no explorer is available', () => {
      const url = getExplorerAddressUrl('some-address');
      expect(url).toBeNull();
    });

    it('returns null for empty address when no explorer', () => {
      const url = getExplorerAddressUrl('');
      expect(url).toBeNull();
    });
  });

  describe('getExplorerTxUrl', () => {
    it('returns null when no explorer is available', () => {
      const url = getExplorerTxUrl('some-tx-hash');
      expect(url).toBeNull();
    });
  });

  describe('getExplorerContractUrl', () => {
    it('returns null when no explorer is available', () => {
      const url = getExplorerContractUrl('some-contract-address');
      expect(url).toBeNull();
    });
  });
});
