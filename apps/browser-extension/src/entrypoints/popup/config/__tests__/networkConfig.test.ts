import { describe, it, expect } from 'vitest';
import { CURRENT_NETWORK, getNetworkConfig } from '../networkConfig';
import type { MidnightNetworkId } from '../networkConfig';

describe('networkConfig', () => {
  it('exports CURRENT_NETWORK as a valid MidnightNetworkId', () => {
    const validNetworks: MidnightNetworkId[] = ['mainnet', 'preprod', 'preview', 'qanet', 'undeployed'];
    expect(validNetworks).toContain(CURRENT_NETWORK);
  });

  describe('getNetworkConfig', () => {
    it('returns correct config for each valid network', () => {
      const networks: MidnightNetworkId[] = ['undeployed', 'preprod', 'preview', 'qanet', 'mainnet'];

      for (const networkId of networks) {
        const config = getNetworkConfig(networkId);
        expect(config.networkId).toBe(networkId);
        expect(config.indexerUrl).toBeTruthy();
        expect(config.wsIndexerUrl).toBeTruthy();
        expect(config.nodeUrl).toBeTruthy();
        expect(config.proofServerUrl).toBeTruthy();
      }
    });

    it('returns localhost URLs for undeployed network', () => {
      const config = getNetworkConfig('undeployed');
      expect(config.indexerUrl).toBe('http://localhost:8088/api/v4/graphql');
      expect(config.wsIndexerUrl).toBe('ws://localhost:8088/api/v4/graphql/ws');
      expect(config.nodeUrl).toBe('http://localhost:9944');
      expect(config.proofServerUrl).toBe('http://localhost:6300');
    });

    it('returns preprod URLs for preprod network', () => {
      const config = getNetworkConfig('preprod');
      expect(config.indexerUrl).toBe('https://indexer.preprod.midnight.network/api/v4/graphql');
      expect(config.wsIndexerUrl).toBe('wss://indexer.preprod.midnight.network/api/v4/graphql/ws');
      expect(config.nodeUrl).toBe('https://rpc.preprod.midnight.network');
      // proofServerUrl may be overridden by VITE_PROOF_SERVER_URL env
      expect(config.proofServerUrl).toBeTruthy();
    });

    it('defaults to CURRENT_NETWORK when no ID provided', () => {
      const config = getNetworkConfig();
      expect(config.networkId).toBe(CURRENT_NETWORK);
    });

    it('throws on unrecognized network ID', () => {
      expect(() => getNetworkConfig('garbage')).toThrow('Unknown network ID: "garbage"');
    });

    it('throws with list of valid IDs in error message', () => {
      expect(() => getNetworkConfig('invalid')).toThrow('Valid IDs:');
    });
  });
});
