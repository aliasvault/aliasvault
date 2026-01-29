import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';
import { browser } from 'wxt/browser';

import { storage } from '#imports';

/**
 * PinUnlockService - Handles PIN-based vault unlock
 *
 * This service allows users to set a 6-8 digit PIN to unlock their vault instead
 * of entering their full master password. The vault encryption key is encrypted
 * with a key derived from the PIN and stored locally.
 *
 * Security features:
 * - 4 failed attempts maximum before requiring full password
 * - PIN must be 6-8 digits
 * - Encryption key derived using Argon2id (memory-hard, GPU-resistant)
 * - Extension ID pepper adds friction for naive attacks
 * - Failed attempts counter stored separately
 * - Encrypted data automatically deleted after max failed attempts
 *
 * Security model
 * - Random salt: Stored locally (prevents rainbow tables)
 * - Extension ID pepper: Derived from browser.runtime.id
 * - Argon2id memory cost: 64 MB makes each attempt expensive
 * - Attempt limiting: 4 attempts max before PIN is disabled
 *
 * Recommendation: Use PIN unlock only on trusted devices. For high-security scenarios, always
 * use full master password unlock.
 */

const PIN_ENABLED_KEY = 'local:aliasvault_pin_enabled';
const PIN_ENCRYPTED_KEY_KEY = 'local:aliasvault_pin_encrypted_key';
const PIN_SALT_KEY = 'local:aliasvault_pin_salt';
const PIN_LENGTH_KEY = 'local:aliasvault_pin_length';
const PIN_FAILED_ATTEMPTS_KEY = 'local:aliasvault_pin_failed_attempts';
const MAX_PIN_ATTEMPTS = 4;

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
    const result = await storage.getItem(PIN_ENABLED_KEY) as boolean | null;
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
    const result = await storage.getItem(PIN_LENGTH_KEY) as number | null;
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Validate PIN format (6-8 digits)
 */
export function isValidPin(pin: string): boolean {
  const pinRegex = /^\d{6,8}$/;
  return pinRegex.test(pin);
}

/**
 * Get failed attempts count
 */
export async function getFailedAttempts(): Promise<number> {
  try {
    const result = await storage.getItem(PIN_FAILED_ATTEMPTS_KEY) as number | null;
    return result || 0;
  } catch {
    return 0;
  }
}

/**
 * Check if PIN attempts are exhausted
 */
export async function isPinLocked(): Promise<boolean> {
  const attempts = await getFailedAttempts();
  return attempts >= MAX_PIN_ATTEMPTS;
}

/**
 * Setup PIN unlock
 * Encrypts the vault encryption key with the PIN and stores it
 *
 * @param pin - The PIN to set (6-8 digits)
 * @param vaultEncryptionKey - The base64-encoded vault encryption key to protect
 */
export async function setupPin(pin: string, vaultEncryptionKey: string): Promise<void> {
  if (!isValidPin(pin)) {
    throw new InvalidPinFormatError();
  }

  try {
    // Generate random salt
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltBase64 = arrayBufferToBase64(salt.buffer);

    // Derive key from PIN using Argon2id
    const combinedSalt = await assembleSaltWithPepper(salt);
    const pinKey = await derivePinKey(pin, combinedSalt);

    // Encrypt the vault encryption key
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedKey = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      pinKey,
      new TextEncoder().encode(vaultEncryptionKey)
    );

    // Combine IV + encrypted data
    const combined = new Uint8Array(iv.length + encryptedKey.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedKey), iv.length);
    const encryptedKeyBase64 = arrayBufferToBase64(combined.buffer);

    /* Store encrypted key, salt, PIN length, and enable flag */
    await Promise.all([
      storage.setItem(PIN_ENABLED_KEY, true),
      storage.setItem(PIN_ENCRYPTED_KEY_KEY, encryptedKeyBase64),
      storage.setItem(PIN_SALT_KEY, saltBase64),
      storage.setItem(PIN_LENGTH_KEY, pin.length),
      storage.setItem(PIN_FAILED_ATTEMPTS_KEY, 0)
    ]);

  } catch (error: unknown) {
    /* Re-throw custom errors as-is */
    if (error instanceof InvalidPinFormatError) {
      throw error;
    }
    /* Log internal errors and throw generic error for user */
    console.error('[PinUnlockService] Failed to setup PIN:', error);
    throw error;
  }
}

/**
 * Unlock with PIN
 * Returns the decrypted vault encryption key
 *
 * @param pin - The PIN to use for unlocking
 * @returns The decrypted vault encryption key (base64)
 */
export async function unlockWithPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) {
    throw new InvalidPinFormatError();
  }

  /* Check if locked due to too many attempts */
  if (await isPinLocked()) {
    throw new PinLockedError();
  }

  try {
    /* Get stored data */
    const [encryptedKeyBase64, saltBase64] = await Promise.all([
      storage.getItem(PIN_ENCRYPTED_KEY_KEY) as Promise<string | null>,
      storage.getItem(PIN_SALT_KEY) as Promise<string | null>
    ]);

    if (!encryptedKeyBase64 || !saltBase64) {
      throw new PinLockedError();
    }

    // Decode encrypted package
    const combined = new Uint8Array(base64ToArrayBuffer(encryptedKeyBase64));
    const iv = combined.slice(0, 12);
    const encryptedData = combined.slice(12);

    // Derive key from PIN with extension ID pepper
    const salt = new Uint8Array(base64ToArrayBuffer(saltBase64));
    const combinedSalt = await assembleSaltWithPepper(salt);
    const pinKey = await derivePinKey(pin, combinedSalt);

    // Decrypt the vault encryption key
    const decryptedData = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      pinKey,
      encryptedData
    );

    const vaultEncryptionKey = new TextDecoder().decode(decryptedData);

    /* Reset failed attempts on success */
    await storage.setItem(PIN_FAILED_ATTEMPTS_KEY, 0);

    return vaultEncryptionKey;
  } catch {
    /* Increment failed attempts */
    const currentAttempts = await getFailedAttempts();
    const newAttempts = currentAttempts + 1;
    await storage.setItem(PIN_FAILED_ATTEMPTS_KEY, newAttempts);

    /*
     * If max attempts reached, disable PIN and clear ALL stored data for security.
     * This prevents offline brute-force attacks on the encrypted key.
     */
    if (newAttempts >= MAX_PIN_ATTEMPTS) {
      await removeAndDisablePin();
      throw new PinLockedError();
    }

    throw new IncorrectPinError(MAX_PIN_ATTEMPTS - newAttempts);
  }
}

/**
 * Disable PIN unlock and remove all stored (encrypted) data.
 */
export async function removeAndDisablePin(): Promise<void> {
  try {
    await Promise.all([
      storage.removeItem(PIN_ENABLED_KEY),
      storage.removeItem(PIN_ENCRYPTED_KEY_KEY),
      storage.removeItem(PIN_SALT_KEY),
      storage.removeItem(PIN_LENGTH_KEY),
      storage.removeItem(PIN_FAILED_ATTEMPTS_KEY)
    ]);
  } catch (error) {
    console.error('[PinUnlockService] Failed to disable PIN:', error);
    throw error;
  }
}

/**
 * Reset failed attempts counter
 * Called after successful password unlock
 */
export async function resetFailedAttempts(): Promise<void> {
  try {
    await storage.setItem(PIN_FAILED_ATTEMPTS_KEY, 0);
  } catch (error) {
    console.error('[PinUnlockService] Failed to reset failed attempts:', error);
  }
}

/**
 * Get extension ID pepper component
 *
 * This provides a device-bound value that is NOT stored in chrome.storage.
 * The extension ID is unique per installation and accessible via browser.runtime.id.
 *
 * Security benefits:
 * - Not stored in chrome.storage directly (however still stored elsewhere on filesystem)
 * - Adds friction for attackers who only copy storage directory
 * - Unique per extension installation
 *
 * @returns SHA-256 hash of extension ID as Uint8Array
 */
async function getExtensionPepper(): Promise<Uint8Array> {
  const extensionId = browser.runtime.id;
  const pepperSource = new TextEncoder().encode(extensionId);
  const pepperHash = await crypto.subtle.digest('SHA-256', pepperSource);
  return new Uint8Array(pepperHash);
}

/**
 * Combine random salt with extension ID pepper
 *
 * Creates a composite salt that includes both:
 * 1. Random salt (stored locally, prevents rainbow tables)
 * 2. Extension ID pepper (not stored, prevents offline brute-force)
 *
 * @param randomSalt - The random salt stored in chrome.storage
 * @returns Combined salt for Argon2id key derivation
 */
async function assembleSaltWithPepper(randomSalt: Uint8Array): Promise<Uint8Array> {
  const pepper = await getExtensionPepper();

  // Combine: random_salt || extension_id_pepper
  const combinedSalt = new Uint8Array(randomSalt.length + pepper.length);
  combinedSalt.set(randomSalt, 0);
  combinedSalt.set(pepper, randomSalt.length);

  return combinedSalt;
}

/**
 * Derive encryption key from PIN using Argon2id
 *
 * Uses Argon2id with high memory cost (64 MB) to make brute-force attacks
 * significantly more expensive. This is especially important for PINs which
 * have lower entropy than passwords.
 *
 * The salt parameter should be the COMBINED salt (random salt + extension pepper)
 * created by assembleSaltWithPepper().
 *
 * Parameters chosen for security:
 * - Memory: 65536 KB (64 MB) - makes GPU attacks much harder
 * - Iterations: 3 - standard for Argon2id
 * - Parallelism: 1 - suitable for browser environment
 * - Output: 32 bytes for AES-256-GCM
 */
async function derivePinKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  // Convert salt to base64 string (required by argon2-browser)
  const saltBase64 = arrayBufferToBase64(salt.buffer as ArrayBuffer);

  // Derive key using Argon2id
  const hash = await argon2.hash({
    pass: pin,
    salt: saltBase64,
    time: 3,
    mem: 65536,
    parallelism: 1,
    hashLen: 32,
    type: 2,
  });

  // Import the derived key into WebCrypto API
  const pinKey = await crypto.subtle.importKey(
    'raw',
    hash.hash,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return pinKey;
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
