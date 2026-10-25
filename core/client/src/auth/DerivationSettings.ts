import { AppErrorCode, formatErrorWithCode } from '../api/errors/AppErrorCodes';

import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';

/** The Argon2id cost fields of an `EncryptionSettings` JSON. */
type CostSettings = { MemorySize?: unknown; Iterations?: unknown };

/**
 * Whether `served` asks for less memory or fewer iterations than `reference`; false when either cannot be read.
 * @param served - the encryption settings JSON the server sent
 * @param reference - the encryption settings JSON this device already derived the unlock key with
 */
export function isWeakerDerivation(served: string, reference: string): boolean {
  const next = parseCost(served);
  const known = parseCost(reference);
  if (!next || !known) {
    return false;
  }
  return next.memory < known.memory || next.iterations < known.iterations;
}

/**
 * Throws when `served` is weaker than `reference`, so a server cannot request a cheaper-to-guess login proof than what device used previously (downgrade attack).
 * @param served - the encryption settings JSON the server sent
 * @param reference - the encryption settings JSON this device already derived the unlock key with
 * @throws Error with {@link AppErrorCode.UNLOCK_SETTINGS_WEAKENED} when the served settings are weaker.
 */
export function assertNotWeakerDerivation(served: string, reference: string): void {
  if (isWeakerDerivation(served, reference)) {
    throw new Error(formatErrorWithCode('The server sent weaker key derivation settings than this device holds', AppErrorCode.UNLOCK_SETTINGS_WEAKENED));
  }
}

/**
 * The memory and iteration cost of an encryption settings JSON, or null when it has no numeric values for them.
 */
function parseCost(settingsJson: string): { memory: number; iterations: number } | null {
  try {
    const parsed = JSON.parse(settingsJson) as CostSettings;
    if (typeof parsed.MemorySize !== 'number' || typeof parsed.Iterations !== 'number') {
      return null;
    }
    return { memory: parsed.MemorySize, iterations: parsed.Iterations };
  } catch {
    return null;
  }
}

/**
 * The unlock key to answer a server's SRP challenge with, for a host that keeps the unlock key of its stored settings:
 * that key while the settings match, a new derivation when another device raised them. Weaker settings are refused.
 * @param challenge - the salt, type and settings the server's challenge carries
 * @param stored - the derivation parameters this device holds
 * @param storedUnlockKeyBase64 - the unlock key derived under the stored parameters
 * @param derive - derives the unlock key from the typed password under the given salt, type and settings
 * @throws Error with {@link AppErrorCode.UNLOCK_SETTINGS_WEAKENED} when the challenge's settings are weaker than the stored ones.
 */
export async function unlockKeyForChallenge(challenge: UnlockKeyDerivationParams, stored: UnlockKeyDerivationParams, storedUnlockKeyBase64: string, derive: (salt: string, encryptionType: string, encryptionSettings: string) => Promise<string>): Promise<string> {
  if (challenge.encryptionSettings === stored.encryptionSettings) {
    return storedUnlockKeyBase64;
  }
  assertNotWeakerDerivation(challenge.encryptionSettings, stored.encryptionSettings);
  return derive(challenge.salt, challenge.encryptionType, challenge.encryptionSettings);
}
