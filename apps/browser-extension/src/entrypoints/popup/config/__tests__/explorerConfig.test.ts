import { describe, it, expect } from 'vitest';
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
