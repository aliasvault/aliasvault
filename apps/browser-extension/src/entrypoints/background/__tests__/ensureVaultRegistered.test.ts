/**
 * Tests for the register-before-save orchestration path extracted from
 * handleUploadVaultToBlockchain. Covers the exact hotfix Story 6.5b added:
 * a first-time user's vault save must call registerVault ONCE, then proceed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ensureVaultRegistered, type VaultRegistrationContract } from '../VaultMessageHandler';

// Minimal WebCrypto polyfill isn't needed — Node 20+ provides globalThis.crypto.subtle.

function makeContract(): VaultRegistrationContract & {
  isVaultRegistered: ReturnType<typeof vi.fn>;
  registerVaultOnChain: ReturnType<typeof vi.fn>;
} {
  return {
    isVaultRegistered: vi.fn(),
    registerVaultOnChain: vi.fn(),
  };
}

describe('ensureVaultRegistered', () => {
  let contract: ReturnType<typeof makeContract>;
  const shieldedAddress = 'mn_shield_addr_bech32m_for_testing';

  beforeEach(() => {
    contract = makeContract();
  });

  it('no-ops when the vault is already registered on-chain', async () => {
    contract.isVaultRegistered.mockResolvedValue(true);

    await ensureVaultRegistered(contract, shieldedAddress);

    expect(contract.isVaultRegistered).toHaveBeenCalledTimes(1);
    expect(contract.registerVaultOnChain).not.toHaveBeenCalled();
  });

  it('calls registerVaultOnChain with a 32-byte hash when not registered', async () => {
    contract.isVaultRegistered.mockResolvedValue(false);
    contract.registerVaultOnChain.mockResolvedValue(undefined);

    await ensureVaultRegistered(contract, shieldedAddress);

    expect(contract.registerVaultOnChain).toHaveBeenCalledTimes(1);
    const [hashArg] = contract.registerVaultOnChain.mock.calls[0];
    expect(hashArg).toBeInstanceOf(Uint8Array);
    expect((hashArg as Uint8Array).length).toBe(32);
  });

  it('derives the hash deterministically from shieldedAddress (SHA-256)', async () => {
    contract.isVaultRegistered.mockResolvedValue(false);
    contract.registerVaultOnChain.mockResolvedValue(undefined);

    await ensureVaultRegistered(contract, shieldedAddress);

    // Compute the expected SHA-256 hash the same way the handler does.
    const expected = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(shieldedAddress)),
    );
    const actual = contract.registerVaultOnChain.mock.calls[0][0] as Uint8Array;
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it('checks registration BEFORE calling register (ordering invariant)', async () => {
    // Use a single call order array so we can assert ordering.
    const callOrder: string[] = [];
    contract.isVaultRegistered.mockImplementation(async () => {
      callOrder.push('isVaultRegistered');
      return false;
    });
    contract.registerVaultOnChain.mockImplementation(async () => {
      callOrder.push('registerVaultOnChain');
    });

    await ensureVaultRegistered(contract, shieldedAddress);

    expect(callOrder).toEqual(['isVaultRegistered', 'registerVaultOnChain']);
  });

  it('throws when shieldedAddress is empty and the vault is not registered', async () => {
    contract.isVaultRegistered.mockResolvedValue(false);

    await expect(ensureVaultRegistered(contract, '')).rejects.toThrow(
      /shieldedAddress not available/i,
    );
    expect(contract.registerVaultOnChain).not.toHaveBeenCalled();
  });

  it('does NOT throw for empty shieldedAddress when vault is already registered', async () => {
    // If already registered, shieldedAddress is not needed.
    contract.isVaultRegistered.mockResolvedValue(true);

    await expect(ensureVaultRegistered(contract, '')).resolves.toBeUndefined();
    expect(contract.registerVaultOnChain).not.toHaveBeenCalled();
  });

  it('swallows "already registered" race errors and continues', async () => {
    contract.isVaultRegistered.mockResolvedValue(false);
    contract.registerVaultOnChain.mockRejectedValue(new Error('Vault already registered'));

    await expect(ensureVaultRegistered(contract, shieldedAddress)).resolves.toBeUndefined();
  });

  it('swallows race errors when the message is embedded in a larger string', async () => {
    contract.isVaultRegistered.mockResolvedValue(false);
    contract.registerVaultOnChain.mockRejectedValue(
      new Error('Contract call failed: Vault already registered for this wallet'),
    );

    await expect(ensureVaultRegistered(contract, shieldedAddress)).resolves.toBeUndefined();
  });

  it('rethrows non-"already registered" errors from registerVaultOnChain', async () => {
    contract.isVaultRegistered.mockResolvedValue(false);
    contract.registerVaultOnChain.mockRejectedValue(new Error('network unreachable'));

    await expect(ensureVaultRegistered(contract, shieldedAddress)).rejects.toThrow(
      'network unreachable',
    );
  });

  it('propagates errors from isVaultRegistered', async () => {
    contract.isVaultRegistered.mockRejectedValue(new Error('indexer down'));

    await expect(ensureVaultRegistered(contract, shieldedAddress)).rejects.toThrow(
      'indexer down',
    );
    expect(contract.registerVaultOnChain).not.toHaveBeenCalled();
  });
});
