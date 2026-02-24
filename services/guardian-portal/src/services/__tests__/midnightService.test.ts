import { describe, it, expect, vi } from 'vitest';

// Mock Midnight SDK modules so the module can load without real SDK
vi.mock('@midnight-ntwrk/midnight-js-contracts', () => ({
  findDeployedContract: vi.fn(),
}));
vi.mock('@midnight-ntwrk/midnight-js-http-client-proof-provider', () => ({
  httpClientProofProvider: vi.fn(),
}));
vi.mock('@midnight-ntwrk/midnight-js-indexer-public-data-provider', () => ({
  indexerPublicDataProvider: vi.fn(),
}));
vi.mock('@midnight-ntwrk/compact-js', () => ({
  CompiledContract: {
    make: vi.fn(() => ({ pipe: vi.fn((fn: unknown) => fn) })),
    withWitnesses: vi.fn((w: unknown) => w),
  },
}));
vi.mock('@aliasvault/contract', () => ({
  GuardianRecovery: { Contract: {} },
  createGuardianRecoveryPrivateState: vi.fn(),
  guardianRecoveryWitnesses: {},
}));

import {
  GUARDIAN_THRESHOLD,
  getContractState,
  isGuardian,
  hasApproved,
} from '../midnightService';

// Helper to build a mock handle with a given ledger
function mockHandle(ledger: Record<string, unknown>) {
  return { deployTxData: { public: ledger } } as Parameters<typeof getContractState>[0];
}

describe('midnightService', () => {
  describe('GUARDIAN_THRESHOLD', () => {
    it('equals 2', () => {
      expect(GUARDIAN_THRESHOLD).toBe(2);
    });
  });

  describe('getContractState', () => {
    it('reads all fields and converts approvedGuardians.size() to number', () => {
      const owner = new Uint8Array([1, 2, 3]);
      const sharesCidHash = new Uint8Array([4, 5, 6]);
      const handle = mockHandle({
        owner,
        guardianCount: 3n,
        recoveryInitiatedAt: 1000n,
        sharesCidHash,
        recoveryComplete: false,
        approvedGuardians: { size: () => 2n },
      });

      const state = getContractState(handle);

      expect(state.owner).toBe(owner);
      expect(state.guardianCount).toBe(3n);
      expect(state.recoveryInitiatedAt).toBe(1000n);
      expect(state.sharesCidHash).toBe(sharesCidHash);
      expect(state.recoveryComplete).toBe(false);
      expect(state.approvalCount).toBe(2);
      expect(typeof state.approvalCount).toBe('number');
    });

    it('handles zero approvedGuardians', () => {
      const handle = mockHandle({
        owner: new Uint8Array(32),
        guardianCount: 0n,
        recoveryInitiatedAt: 0n,
        sharesCidHash: new Uint8Array(32),
        recoveryComplete: false,
        approvedGuardians: { size: () => 0n },
      });

      expect(getContractState(handle).approvalCount).toBe(0);
    });
  });

  describe('isGuardian', () => {
    it('returns true when commitment is a member', () => {
      const commitment = new Uint8Array([10, 20]);
      const handle = mockHandle({
        guardians: { member: (c: Uint8Array) => c === commitment },
      });

      expect(isGuardian(handle, commitment)).toBe(true);
    });

    it('returns false when commitment is not a member', () => {
      const handle = mockHandle({
        guardians: { member: () => false },
      });

      expect(isGuardian(handle, new Uint8Array([99]))).toBe(false);
    });
  });

  describe('hasApproved', () => {
    it('returns true when commitment is in approvedGuardians', () => {
      const commitment = new Uint8Array([10, 20]);
      const handle = mockHandle({
        approvedGuardians: { member: (c: Uint8Array) => c === commitment },
      });

      expect(hasApproved(handle, commitment)).toBe(true);
    });

    it('returns false when commitment is not in approvedGuardians', () => {
      const handle = mockHandle({
        approvedGuardians: { member: () => false },
      });

      expect(hasApproved(handle, new Uint8Array([99]))).toBe(false);
    });
  });
});
