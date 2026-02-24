import { describe, it, expect } from 'vitest';
import { getNetworkConfig, CURRENT_NETWORK } from '../networkConfig';

describe('networkConfig', () => {
  it('returns config for valid network IDs', () => {
    const config = getNetworkConfig('undeployed');
    expect(config.networkId).toBe('undeployed');
    expect(config.indexerUrl).toContain('localhost');
  });

  it('returns current network when no ID provided', () => {
    const config = getNetworkConfig();
    expect(config.networkId).toBe(CURRENT_NETWORK);
  });

  it('throws on unrecognized network ID', () => {
    expect(() => getNetworkConfig('garbage')).toThrow('Unknown network ID: "garbage"');
  });

  it('throws with list of valid IDs', () => {
    expect(() => getNetworkConfig('invalid')).toThrow('Valid IDs:');
  });
});
