import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @aliasvault/vault-sync
vi.mock('@aliasvault/vault-sync', () => ({
  generateGuardianKeyPair: vi.fn().mockResolvedValue({
    publicKey: { kty: 'RSA', n: 'test-n', e: 'AQAB' },
    privateKey: { kty: 'RSA', n: 'test-n', e: 'AQAB', d: 'test-d' },
  }),
  bytesToHex: vi.fn((arr: Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')),
  hexToUint8Array: vi.fn((hex: string) => {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
    return arr;
  }),
}));

// Mock @aliasvault/contract
vi.mock('@aliasvault/contract', () => ({
  GuardianRecovery: {
    pureCircuits: {
      guardianCommitment: vi.fn((key: Uint8Array) => {
        // Return a deterministic mock commitment based on input
        const result = new Uint8Array(32);
        result.set(key.slice(0, 32));
        result[0] = result[0]! ^ 0xff; // Flip first byte to simulate commitment
        return result;
      }),
    },
  },
}));

import { generateGuardianKeys, loadGuardianKeys, hasStoredKeys, getGuardianCommitment } from '../guardianKeyService';

describe('guardianKeyService', () => {
  const contractAddress = 'test-contract-addr-001';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('generateGuardianKeys', () => {
    it('returns valid keys with commitment', async () => {
      const keys = await generateGuardianKeys(contractAddress);

      expect(keys.guardianKeyHex).toHaveLength(64); // 32 bytes as hex
      expect(keys.rsaPublicKey).toBeDefined();
      expect(keys.rsaPublicKey.kty).toBe('RSA');
      expect(keys.rsaPrivateKey).toBeDefined();
      expect(keys.rsaPrivateKey.kty).toBe('RSA');
      expect(keys.commitment).toBeDefined();
      expect(keys.commitment.length).toBeGreaterThan(0);
    });

    it('stores keys in localStorage', async () => {
      await generateGuardianKeys(contractAddress);

      const stored = localStorage.getItem(`guardian:${contractAddress}:keys`);
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.guardianKeyHex).toBeDefined();
      expect(parsed.rsaPublicKey).toBeDefined();
    });
  });

  describe('loadGuardianKeys', () => {
    it('returns null when no keys stored', () => {
      expect(loadGuardianKeys(contractAddress)).toBeNull();
    });

    it('returns stored keys after generation', async () => {
      const generated = await generateGuardianKeys(contractAddress);
      const loaded = loadGuardianKeys(contractAddress);

      expect(loaded).not.toBeNull();
      expect(loaded!.guardianKeyHex).toBe(generated.guardianKeyHex);
      expect(loaded!.commitment).toBe(generated.commitment);
    });

    it('returns null for corrupted JSON in localStorage', () => {
      localStorage.setItem(`guardian:${contractAddress}:keys`, 'not-valid-json');
      expect(loadGuardianKeys(contractAddress)).toBeNull();
    });

    it('returns null for JSON missing required fields', () => {
      localStorage.setItem(`guardian:${contractAddress}:keys`, JSON.stringify({ foo: 'bar' }));
      expect(loadGuardianKeys(contractAddress)).toBeNull();
    });

    it('returns null for JSON with wrong field types', () => {
      localStorage.setItem(`guardian:${contractAddress}:keys`, JSON.stringify({
        guardianKeyHex: 123,
        commitment: 'valid',
        rsaPublicKey: {},
        rsaPrivateKey: {},
      }));
      expect(loadGuardianKeys(contractAddress)).toBeNull();
    });
  });

  describe('hasStoredKeys', () => {
    it('returns false before generation', () => {
      expect(hasStoredKeys(contractAddress)).toBe(false);
    });

    it('returns true after generation', async () => {
      await generateGuardianKeys(contractAddress);
      expect(hasStoredKeys(contractAddress)).toBe(true);
    });

    it('returns false for corrupted JSON', () => {
      localStorage.setItem(`guardian:${contractAddress}:keys`, 'not-valid-json');
      expect(hasStoredKeys(contractAddress)).toBe(false);
    });

    it('returns false for JSON missing required fields', () => {
      localStorage.setItem(`guardian:${contractAddress}:keys`, JSON.stringify({ foo: 'bar' }));
      expect(hasStoredKeys(contractAddress)).toBe(false);
    });
  });

  describe('getGuardianCommitment', () => {
    it('calls pureCircuits.guardianCommitment and returns result', () => {
      const key = new Uint8Array(32).fill(0xab);
      const commitment = getGuardianCommitment(key);

      expect(commitment).toBeInstanceOf(Uint8Array);
      expect(commitment.length).toBe(32);
    });
  });
});
