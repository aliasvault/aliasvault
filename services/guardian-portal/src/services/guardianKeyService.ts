import { generateGuardianKeyPair, bytesToHex, hexToUint8Array } from '@aliasvault/vault-sync';
import { GuardianRecovery } from '@aliasvault/contract';
import type { GuardianKeys } from '../types/recovery';

const STORAGE_PREFIX = 'guardian:';

function storageKey(contractAddress: string): string {
  return `${STORAGE_PREFIX}${contractAddress}:keys`;
}

/**
 * Generate guardian key (32 bytes random) + RSA key pair.
 * Computes guardian commitment via compiled contract's pureCircuits.
 * Stores everything in localStorage keyed by contract address.
 *
 * CRITICAL: Guardian commitment MUST use pureCircuits.guardianCommitment()
 * from the compiled GuardianRecovery contract — NOT manual persistentCommit.
 */
export async function generateGuardianKeys(contractAddress: string): Promise<GuardianKeys> {
  const guardianKey = crypto.getRandomValues(new Uint8Array(32));
  const rsaKeyPair = await generateGuardianKeyPair();

  const commitment = getGuardianCommitment(guardianKey);
  const commitmentHex = bytesToHex(commitment);

  const keys: GuardianKeys = {
    guardianKeyHex: bytesToHex(guardianKey),
    rsaPrivateKey: rsaKeyPair.privateKey,
    rsaPublicKey: rsaKeyPair.publicKey,
    commitment: commitmentHex,
  };

  localStorage.setItem(storageKey(contractAddress), JSON.stringify(keys));
  return keys;
}

/**
 * Load stored guardian keys for a contract address.
 */
export function loadGuardianKeys(contractAddress: string): GuardianKeys | null {
  const stored = localStorage.getItem(storageKey(contractAddress));
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    if (
      typeof parsed.guardianKeyHex !== 'string' ||
      typeof parsed.commitment !== 'string' ||
      !parsed.rsaPublicKey ||
      !parsed.rsaPrivateKey
    ) {
      return null;
    }
    return parsed as unknown as GuardianKeys;
  } catch {
    return null;
  }
}

/**
 * Check if valid keys exist in localStorage for a contract address.
 * Delegates to loadGuardianKeys() so corrupted/incomplete data returns false.
 */
export function hasStoredKeys(contractAddress: string): boolean {
  return loadGuardianKeys(contractAddress) !== null;
}

/**
 * Compute guardian commitment using compiled contract's pure circuit.
 * Uses domain separator pad(32, "recovery:guardian:") internally.
 */
export function getGuardianCommitment(guardianKey: Uint8Array): Uint8Array {
  return GuardianRecovery.pureCircuits.guardianCommitment(guardianKey);
}

/**
 * Get the guardian key as Uint8Array from stored keys.
 */
export function getGuardianKeyBytes(keys: GuardianKeys): Uint8Array {
  return hexToUint8Array(keys.guardianKeyHex);
}
