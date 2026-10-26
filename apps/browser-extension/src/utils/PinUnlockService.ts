import { pinDecrypt, pinEncrypt, pinExtensionSalt, pinGenerateSalt, pinIsLocked, pinRegisterFailure } from '@aliasvault/client/rust/RustCore';
import { base64ToBytes, bytesToBase64 } from '@aliasvault/client/utilities/Base64';

import { PIN_STORAGE_KEYS, StorageKeys } from '@/utils/constants/storageKeys';
import { logFailure } from '@/utils/Diagnostics';

import { browser, storage } from '#imports';

/**
 * PinUnlockService - Handles PIN-based vault unlock
 *
 * This service allows users to set a PIN (digits, letters or symbols) to unlock their vault instead
 * of entering their full master password. The Account Key
 * is encrypted with a key derived from the PIN and stored locally.
 */

/**
 * Error thrown when PIN is locked after too many failed attempts.
 * Translation key: settings.unlockMethod.pinLocked
 */
export class PinLockedError extends Error {
  /**
   * Creates a new instance of PinLockedError.
   */
  public constructor() {
    super('PIN locked after too many failed attempts');
    this.name = 'PinLockedError';
  }
}

/**
 * Error thrown when PIN format is invalid.
 * Translation key: settings.unlockMethod.invalidPinFormat
 */
export class InvalidPinFormatError extends Error {
  /**
   * Creates a new instance of InvalidPinFormatError.
   */
  public constructor() {
    super('Invalid PIN format');
    this.name = 'InvalidPinFormatError';
  }
}

/**
 * Error thrown when PIN is incorrect.
 * Includes remaining attempts count.
 * Translation key: settings.unlockMethod.incorrectPin
 */
export class IncorrectPinError extends Error {
  public readonly attemptsRemaining: number;

  /**
   * Creates a new instance of IncorrectPinError.
   * @param attemptsRemaining - Number of attempts remaining
   */
  public constructor(attemptsRemaining: number) {
    super(`Incorrect PIN. ${attemptsRemaining} attempts remaining.`);
    this.name = 'IncorrectPinError';
    this.attemptsRemaining = attemptsRemaining;
  }
}

/**
 * Error thrown when encryption key is not available for PIN setup.
 */
export class EncryptionKeyNotAvailableError extends Error {
  /**
   * Creates a new instance of EncryptionKeyNotAvailableError.
   */
  public constructor() {
    super('Encryption key not available');
    this.name = 'EncryptionKeyNotAvailableError';
  }
}

/**
 * Check if PIN unlock is enabled
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
 * Get the length of the configured PIN
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
 * Validate PIN format (6-64 characters of any kind)
 */
export function isValidPin(pin: string): boolean {
  return pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH;
}

/**
 * Get the failed attempts count, or null when the stored counter is unreadable (which counts as locked).
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
 * Check if PIN attempts are exhausted
 */
export async function isPinLocked(): Promise<boolean> {
  const attempts = await getFailedAttempts();
  return attempts === null || await pinIsLocked(attempts);
}

/**
 * Setup PIN unlock
 * Encrypts the session's Account Key with the PIN and stores it
 *
 * @param pin - The PIN to set (6-64 characters)
 * @param accountKey - The base64 Account Key to protect (VaultKeyService.getSessionAccountKey)
 */
export async function setupPin(pin: string, accountKey: string): Promise<void> {
  if (!isValidPin(pin)) {
    throw new InvalidPinFormatError();
  }

  try {
    const salt = await pinGenerateSalt();
    const saltBase64 = bytesToBase64(salt);
    const encryptedKeyBase64 = bytesToBase64(await pinEncrypt(pin, await argon2Salt(salt), new TextEncoder().encode(accountKey)));

    /* Store encrypted key, salt, PIN length, and enable flag */
    await Promise.all([
      storage.setItem(StorageKeys.PIN_ENABLED, true),
      storage.setItem(StorageKeys.PIN_ENCRYPTED_KEY, encryptedKeyBase64),
      storage.setItem(StorageKeys.PIN_SALT, saltBase64),
      storage.setItem(StorageKeys.PIN_LENGTH, pin.length),
      storage.setItem(StorageKeys.PIN_FAILED_ATTEMPTS, 0)
    ]);

  } catch (error: unknown) {
    /* Re-throw custom errors as-is */
    if (error instanceof InvalidPinFormatError) {
      throw error;
    }
    /* Log internal errors and throw generic error for user */
    logFailure('[PinUnlockService] Failed to setup PIN', error);
    throw error;
  }
}

/**
 * Unlock with PIN
 * Returns the decrypted stored key (the Account Key, or an unlock key from before the account had a key chain)
 *
 * @param pin - The PIN to use for unlocking
 * @returns The decrypted key (base64), which opens the account key chain
 */
export async function unlockWithPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) {
    throw new InvalidPinFormatError();
  }

  /* Check if locked due to too many attempts */
  const failedAttempts = await getFailedAttempts();
  if (failedAttempts === null || await pinIsLocked(failedAttempts)) {
    throw new PinLockedError();
  }

  try {
    /* Get stored data */
    const [encryptedKeyBase64, saltBase64] = await Promise.all([
      storage.getItem(StorageKeys.PIN_ENCRYPTED_KEY) as Promise<string | null>,
      storage.getItem(StorageKeys.PIN_SALT) as Promise<string | null>
    ]);

    if (!encryptedKeyBase64 || !saltBase64) {
      throw new PinLockedError();
    }

    const decryptedData = await pinDecrypt(pin, await argon2Salt(base64ToBytes(saltBase64)), base64ToBytes(encryptedKeyBase64));
    const unlockKey = new TextDecoder().decode(decryptedData);

    /* Reset failed attempts on success */
    await storage.setItem(StorageKeys.PIN_FAILED_ATTEMPTS, 0);

    return unlockKey;
  } catch {
    const failure = await pinRegisterFailure(failedAttempts);
    await storage.setItem(StorageKeys.PIN_FAILED_ATTEMPTS, failure.failedAttempts);

    /*
     * If max attempts reached, disable PIN and clear ALL stored data for security.
     * This prevents offline brute-force attacks on the encrypted key.
     */
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
 * Reset failed attempts counter
 * Called after successful password unlock
 */
export async function resetFailedAttempts(): Promise<void> {
  try {
    await storage.setItem(StorageKeys.PIN_FAILED_ATTEMPTS, 0);
  } catch (error) {
    logFailure('[PinUnlockService] Failed to reset failed attempts', error);
  }
}

/**
 * The Argon2id salt for the PIN key: the stored random salt with the extension ID as pepper, composed in the Rust core.
 *
 * The extension ID is not stored in chrome.storage, which adds friction for an attacker who only copies that directory.
 *
 * @param randomSalt - The random salt stored in chrome.storage
 */
async function argon2Salt(randomSalt: Uint8Array): Promise<Uint8Array> {
  return pinExtensionSalt(randomSalt, browser.runtime.id);
}
