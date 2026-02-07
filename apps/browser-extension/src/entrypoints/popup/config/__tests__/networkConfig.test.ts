import { describe, it, expect } from 'vitest';
import { CURRENT_NETWORK } from '../networkConfig';
import type { MidnightNetworkId } from '../networkConfig';

describe('networkConfig', () => {
  it('exports CURRENT_NETWORK as a valid MidnightNetworkId', () => {
    const validNetworks: MidnightNetworkId[] = ['mainnet', 'preprod', 'preview', 'qanet', 'undeployed'];
    expect(validNetworks).toContain(CURRENT_NETWORK);
  });

  it('defaults to undeployed for local development', () => {
    expect(CURRENT_NETWORK).toBe('undeployed');
  });
});
