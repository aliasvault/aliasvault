/**
 * PIN unlock: the Account Key encrypted with a key derived from the PIN, stored locally with the failed-attempt counter.
 */

import { pinDecrypt, pinEncrypt, pinExtensionSalt, pinGenerateSalt, pinIsLocked, pinRegisterFailure } from '@aliasvault/client/rust/RustCore';
import { base64ToBytes, bytesToBase64 } from '@aliasvault/client/utilities/Base64';

import { PIN_STORAGE_KEYS, StorageKeys } from '@/utils/constants/storageKeys';
import { logFailure } from '@/utils/Diagnostics';

import { browser, storage } from '#imports';

/**
 * The PIN is locked after too many failed attempts (translation key settings.unlockMethod.pinLocked).
 */
export class PinLockedError extends Error {
  /**
   * Creates the error.
   */
  public constructor() {
    super('PIN locked after too many failed attempts');
    this.name = 'PinLockedError';
  }
}

/**
 * The PIN has an invalid format (translation key settings.unlockMethod.invalidPinFormat).
 */
export class InvalidPinFormatError extends Error {
  /**
   * Creates the error.
   */
  public constructor() {
    super('Invalid PIN format');
    this.name = 'InvalidPinFormatError';
  }
}

/**
 * The PIN is incorrect (translation key settings.unlockMethod.incorrectPin).
 */
export class IncorrectPinError extends Error {
  public readonly attemptsRemaining: number;

  /**
   * Creates the error.
   * @param attemptsRemaining - Attempts left before the PIN locks
   */
  public constructor(attemptsRemaining: number) {
    super(`Incorrect PIN. ${attemptsRemaining} attempts remaining.`);
    this.name = 'IncorrectPinError';
    this.attemptsRemaining = attemptsRemaining;
  }
}

/**
 * Whether PIN unlock is enabled.
 */
export async function isPinEnabled(): Promise<boolean> {
  try {
    const result = await storage.getItem(StorageKeys.PIN_ENABLED) as boolean | null;
    return result === true;
  } catch {
    return false;
  }
}

/**
 * The length of the configured PIN, or null when none is set.
 */
export async function getPinLength(): Promise<number | null> {
  try {
    const result = await storage.getItem(StorageKeys.PIN_LENGTH) as number | null;
    return result || null;
  } catch {
    return null;
  }
}

/** Minimum PIN length. */
export const PIN_MIN_LENGTH = 6;

/** Maximum PIN length. */
export const PIN_MAX_LENGTH = 64;

/**
 * Whether a PIN has a valid format: 6 to 64 characters of any kind.
 */
export function isValidPin(pin: string): boolean {
  return pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH;
}

/**
 * The failed-attempt count, or null when the stored counter is unreadable (which counts as locked).
 */
async function getFailedAttempts(): Promise<number | null> {
  try {
    const result = await storage.getItem(StorageKeys.PIN_FAILED_ATTEMPTS);
    if (result === null || result === undefined) {
      return 0;
    }
    return Number.isInteger(result) && (result as number) >= 0 ? result as number : null;
  } catch {
    return null;
  }
}

/**
 * Whether the PIN is locked after too many failed attempts.
 */
export async function isPinLocked(): Promise<boolean> {
  const attempts = await getFailedAttempts();
  return attempts === null || await pinIsLocked(attempts);
}

/**
 * Encrypt the session's Account Key with the PIN and store it.
 * @param pin - The PIN to set (6-64 characters)
 * @param accountKey - The base64 Account Key to protect
 */
export async function setupPin(pin: string, accountKey: string): Promise<void> {
  if (!isValidPin(pin)) {
    throw new InvalidPinFormatError();
  }

  try {
    const salt = await pinGenerateSalt();
    const saltBase64 = bytesToBase64(salt);
    const encryptedKeyBase64 = bytesToBase64(await pinEncrypt(pin, await argon2Salt(salt), new TextEncoder().encode(accountKey)));

    await Promise.all([
      storage.setItem(StorageKeys.PIN_ENABLED, true),
      storage.setItem(StorageKeys.PIN_ENCRYPTED_KEY, encryptedKeyBase64),
      storage.setItem(StorageKeys.PIN_SALT, saltBase64),
      storage.setItem(StorageKeys.PIN_LENGTH, pin.length),
      storage.setItem(StorageKeys.PIN_FAILED_ATTEMPTS, 0)
    ]);
  } catch (error: unknown) {
    logFailure('[PinUnlockService] Failed to setup PIN', error);
    throw error;
  }
}

/**
 * Decrypt the stored key with the PIN.
 * @param pin - The PIN
 * @returns The decrypted key (base64)
 */
export async function unlockWithPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) {
    throw new InvalidPinFormatError();
  }

  const failedAttempts = await getFailedAttempts();
  if (failedAttempts === null || await pinIsLocked(failedAttempts)) {
    throw new PinLockedError();
  }

  try {
    const [encryptedKeyBase64, saltBase64] = await Promise.all([
      storage.getItem(StorageKeys.PIN_ENCRYPTED_KEY) as Promise<string | null>,
      storage.getItem(StorageKeys.PIN_SALT) as Promise<string | null>
    ]);

    if (!encryptedKeyBase64 || !saltBase64) {
      throw new PinLockedError();
    }

    const decryptedData = await pinDecrypt(pin, await argon2Salt(base64ToBytes(saltBase64)), base64ToBytes(encryptedKeyBase64));
    const storedKey = new TextDecoder().decode(decryptedData);

    await storage.setItem(StorageKeys.PIN_FAILED_ATTEMPTS, 0);

    return storedKey;
  } catch {
    const failure = await pinRegisterFailure(failedAttempts);
    await storage.setItem(StorageKeys.PIN_FAILED_ATTEMPTS, failure.failedAttempts);

    // Locked: the encrypted key is deleted so it cannot be brute-forced offline.
    if (failure.locked) {
      await removeAndDisablePin();
      throw new PinLockedError();
    }

    throw new IncorrectPinError(failure.attemptsRemaining);
  }
}

/**
 * Disable PIN unlock and remove all stored (encrypted) data. Logout does not depend on this: the same keys are
 * part of `vaultDataStorageKeys()`, so every logout path clears them in the background.
 */
export async function removeAndDisablePin(): Promise<void> {
  try {
    await storage.removeItems([...PIN_STORAGE_KEYS]);
  } catch (error) {
    logFailure('[PinUnlockService] Failed to disable PIN', error);
    throw error;
  }
}

/**
 * Reset the failed-attempt counter, after a successful password unlock.
 */
export async function resetFailedAttempts(): Promise<void> {
  try {
    await storage.setItem(StorageKeys.PIN_FAILED_ATTEMPTS, 0);
  } catch (error) {
    logFailure('[PinUnlockService] Failed to reset failed attempts', error);
  }
}

/**
 * The Argon2id salt for the PIN key: the stored random salt with the extension id, which the storage directory alone
 * does not reveal.
 * @param randomSalt - The random salt as stored
 */
async function argon2Salt(randomSalt: Uint8Array): Promise<Uint8Array> {
  return pinExtensionSalt(randomSalt, browser.runtime.id);
}
