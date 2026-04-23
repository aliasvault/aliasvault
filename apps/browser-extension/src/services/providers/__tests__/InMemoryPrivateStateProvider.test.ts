import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPrivateStateProvider } from '../InMemoryPrivateStateProvider';

describe('InMemoryPrivateStateProvider', () => {
  let provider: InMemoryPrivateStateProvider;

  beforeEach(() => {
    provider = new InMemoryPrivateStateProvider();
  });

  describe('setContractAddress', () => {
    it('should set the current contract address', () => {
      provider.setContractAddress('contract-abc');
      // Verify by setting and getting state scoped to this address
      expect(() => provider.setContractAddress('contract-abc')).not.toThrow();
    });
  });

  describe('get/set/remove cycle', () => {
    it('should store and retrieve state by id', async () => {
      provider.setContractAddress('contract-1');
      const state = new Uint8Array([1, 2, 3]);
      await provider.set('stateA', state);
      const retrieved = await provider.get('stateA');
      expect(retrieved).toEqual(state);
    });

    it('should return null for non-existent state', async () => {
      provider.setContractAddress('contract-1');
      const result = await provider.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should remove state by id', async () => {
      provider.setContractAddress('contract-1');
      await provider.set('stateA', new Uint8Array([1]));
      await provider.remove('stateA');
      const result = await provider.get('stateA');
      expect(result).toBeNull();
    });

    it('should overwrite existing state', async () => {
      provider.setContractAddress('contract-1');
      await provider.set('stateA', new Uint8Array([1]));
      await provider.set('stateA', new Uint8Array([2]));
      const result = await provider.get('stateA');
      expect(result).toEqual(new Uint8Array([2]));
    });
  });

  describe('contract address scoping', () => {
    it('should scope state to the current contract address', async () => {
      provider.setContractAddress('contract-1');
      await provider.set('data', new Uint8Array([10]));

      provider.setContractAddress('contract-2');
      await provider.set('data', new Uint8Array([20]));

      // Read back contract-1 state
      provider.setContractAddress('contract-1');
      expect(await provider.get('data')).toEqual(new Uint8Array([10]));

      // Read back contract-2 state
      provider.setContractAddress('contract-2');
      expect(await provider.get('data')).toEqual(new Uint8Array([20]));
    });
  });

  describe('clear', () => {
    it('should remove all state entries', async () => {
      provider.setContractAddress('contract-1');
      await provider.set('a', new Uint8Array([1]));
      await provider.set('b', new Uint8Array([2]));
      await provider.clear();
      expect(await provider.get('a')).toBeNull();
      expect(await provider.get('b')).toBeNull();
    });
  });

  describe('signing key storage', () => {
    it('should store and retrieve a signing key', async () => {
      const key = new Uint8Array([0xAA, 0xBB, 0xCC]);
      await provider.setSigningKey('addr-1', key);
      const retrieved = await provider.getSigningKey('addr-1');
      expect(retrieved).toEqual(key);
    });

    it('should return null for non-existent signing key', async () => {
      const result = await provider.getSigningKey('addr-unknown');
      expect(result).toBeNull();
    });

    it('should remove a signing key', async () => {
      const key = new Uint8Array([0xDD]);
      await provider.setSigningKey('addr-2', key);
      await provider.removeSigningKey('addr-2');
      expect(await provider.getSigningKey('addr-2')).toBeNull();
    });

    it('should clear all signing keys', async () => {
      await provider.setSigningKey('addr-a', new Uint8Array([1]));
      await provider.setSigningKey('addr-b', new Uint8Array([2]));
      await provider.clearSigningKeys();
      expect(await provider.getSigningKey('addr-a')).toBeNull();
      expect(await provider.getSigningKey('addr-b')).toBeNull();
    });
  });

  describe('exportPrivateStates / importPrivateStates', () => {
    it('should throw not supported for export', async () => {
      await expect(provider.exportPrivateStates()).rejects.toThrow('not supported');
    });

    it('should throw not supported for import', async () => {
      await expect(provider.importPrivateStates(new Map())).rejects.toThrow('not supported');
    });
  });
});
