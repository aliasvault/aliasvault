/**
 * PinUnlockService - Handles PIN-based vault unlock
 *
 * This service allows users to set a 4-8 digit PIN to unlock their vault instead
 * of entering their full master password. The vault encryption key is encrypted
 * with a key derived from the PIN and stored locally.
 *
 * Security features:
 * - 4 failed attempts maximum before requiring full password
 * - PIN must be 4-8 digits
 * - Encryption key derived using PBKDF2 with random salt
 * - Failed attempts counter stored separately
 */

const PIN_ENABLED_KEY = 'aliasvault_pin_enabled';
const PIN_ENCRYPTED_KEY_KEY = 'aliasvault_pin_encrypted_key';
const PIN_SALT_KEY = 'aliasvault_pin_salt';
const PIN_LENGTH_KEY = 'aliasvault_pin_length';
const PIN_FAILED_ATTEMPTS_KEY = 'aliasvault_pin_failed_attempts';
const MAX_PIN_ATTEMPTS = 4;
const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 8;

/**
 * Error thrown when PIN is locked after too many failed attempts.
 */
export class PinLockedError extends Error {
  /**
   * Creates a new instance of PinLockedError.
   * @param message - The error message.
   */
  public constructor(message: string = 'PIN locked after too many failed attempts') {
    super(message);
    this.name = 'PinLockedError';
  }
}

/**
 * Check if PIN unlock is enabled
 */
export async function isPinEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get([PIN_ENABLED_KEY]);
    return result[PIN_ENABLED_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * Get the length of the configured PIN
 */
export async function getPinLength(): Promise<number | null> {
  try {
    const result = await chrome.storage.local.get([PIN_LENGTH_KEY]);
    return result[PIN_LENGTH_KEY] || null;
  } catch {
    return null;
  }
}

/**
 * Validate PIN format (4-8 digits)
 */
export function isValidPin(pin: string): boolean {
  const pinRegex = /^\d{4,8}$/;
  return pinRegex.test(pin);
}

/**
 * Get failed attempts count
 */
export async function getFailedAttempts(): Promise<number> {
  try {
    const result = await chrome.storage.local.get([PIN_FAILED_ATTEMPTS_KEY]);
    return result[PIN_FAILED_ATTEMPTS_KEY] || 0;
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
 * @param pin - The PIN to set (4-8 digits)
 * @param vaultEncryptionKey - The base64-encoded vault encryption key to protect
 */
export async function setupPin(pin: string, vaultEncryptionKey: string): Promise<void> {
  if (!isValidPin(pin)) {
    throw new Error(`PIN must be ${MIN_PIN_LENGTH}-${MAX_PIN_LENGTH} digits`);
  }

  try {
    // Generate random salt
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltBase64 = arrayBufferToBase64(salt.buffer);

    // Derive key from PIN using PBKDF2
    const pinKey = await derivePinKey(pin, salt);

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

    // Store encrypted key, salt, PIN length, and enable flag
    await chrome.storage.local.set({
      [PIN_ENABLED_KEY]: true,
      [PIN_ENCRYPTED_KEY_KEY]: encryptedKeyBase64,
      [PIN_SALT_KEY]: saltBase64,
      [PIN_LENGTH_KEY]: pin.length,
      [PIN_FAILED_ATTEMPTS_KEY]: 0
    });

  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to setup PIN: ${error.message}`);
    }
    throw new Error('Failed to setup PIN');
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
    throw new Error('Invalid PIN format');
  }

  // Check if locked due to too many attempts
  if (await isPinLocked()) {
    throw new Error('Too many failed attempts. Please use your master password.');
  }

  try {
    // Get stored data
    const result = await chrome.storage.local.get([
      PIN_ENCRYPTED_KEY_KEY,
      PIN_SALT_KEY,
      PIN_FAILED_ATTEMPTS_KEY
    ]);

    const encryptedKeyBase64 = result[PIN_ENCRYPTED_KEY_KEY];
    const saltBase64 = result[PIN_SALT_KEY];

    if (!encryptedKeyBase64 || !saltBase64) {
      throw new Error('PIN unlock is not configured');
    }

    // Decode encrypted package
    const combined = new Uint8Array(base64ToArrayBuffer(encryptedKeyBase64));
    const iv = combined.slice(0, 12);
    const encryptedData = combined.slice(12);

    // Derive key from PIN
    const salt = new Uint8Array(base64ToArrayBuffer(saltBase64));
    const pinKey = await derivePinKey(pin, salt);

    // Decrypt the vault encryption key
    const decryptedData = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      pinKey,
      encryptedData
    );

    const vaultEncryptionKey = new TextDecoder().decode(decryptedData);

    // Reset failed attempts on success
    await chrome.storage.local.set({ [PIN_FAILED_ATTEMPTS_KEY]: 0 });

    return vaultEncryptionKey;
  } catch {
    // Increment failed attempts
    const currentAttempts = await getFailedAttempts();
    const newAttempts = currentAttempts + 1;
    await chrome.storage.local.set({ [PIN_FAILED_ATTEMPTS_KEY]: newAttempts });

    // If max attempts reached, disable PIN and clear stored data
    if (newAttempts >= MAX_PIN_ATTEMPTS) {
      throw new PinLockedError();
    }

    throw new Error(`Incorrect PIN. ${MAX_PIN_ATTEMPTS - newAttempts} attempts remaining.`);
  }
}

/**
 * Disable PIN unlock and clear all stored data
 */
export async function disablePin(): Promise<void> {
  try {
    await chrome.storage.local.remove([
      PIN_ENABLED_KEY,
      PIN_ENCRYPTED_KEY_KEY,
      PIN_SALT_KEY,
      PIN_LENGTH_KEY,
      PIN_FAILED_ATTEMPTS_KEY
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
    await chrome.storage.local.set({ [PIN_FAILED_ATTEMPTS_KEY]: 0 });
  } catch (error) {
    console.error('[PinUnlockService] Failed to reset failed attempts:', error);
  }
}

/**
 * Derive encryption key from PIN using PBKDF2
 */
async function derivePinKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  // Import PIN as key material
  const pinMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  // Derive AES-GCM key using PBKDF2
  const pinKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000, // 100k iterations for security
      hash: 'SHA-256'
    },
    pinMaterial,
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
