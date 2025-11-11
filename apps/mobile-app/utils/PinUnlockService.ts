import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Mobile app PIN unlock service
 * Provides a TypeScript interface for native PIN unlock functionality
 */

/**
 * Error thrown when PIN is locked after too many failed attempts.
 */
export class PinLockedError extends Error {
  /**
   * Creates a new instance of PinLockedError.
   */
  public constructor() {
    super('PIN is locked due to too many failed attempts');
    this.name = 'PinLockedError';
  }
}

/**
 * Error thrown when an incorrect PIN is provided.
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
 * Check if PIN unlock is enabled
 */
export async function isPinEnabled(): Promise<boolean> {
  try {
    return await NativeVaultManager.isPinEnabled();
  } catch {
    return false;
  }
}

/**
 * Get the length of the configured PIN
 */
export async function getPinLength(): Promise<number | null> {
  try {
    return await NativeVaultManager.getPinLength();
  } catch {
    return null;
  }
}

/**
 * Setup PIN unlock
 * The vault must be unlocked - encryption key is retrieved internally by native code
 * and never exposed to the React Native layer
 *
 * @param pin - The PIN to set (4-8 digits)
 */
export async function setupPin(pin: string): Promise<void> {
  try {
    await NativeVaultManager.setupPin(pin);
  } catch (error: unknown) {
    console.error('[PinUnlockService] Failed to setup PIN:', error);
    throw error;
  }
}

/**
 * Unlock with PIN
 * Returns the decrypted vault encryption key
 * On success, failed attempts are automatically reset by native code
 * On max failures, PIN is automatically disabled by native code
 *
 * @param pin - The PIN to use for unlocking
 * @returns The decrypted vault encryption key (base64)
 */
export async function unlockWithPin(pin: string): Promise<string> {
  try {
    const vaultEncryptionKey = await NativeVaultManager.unlockWithPin(pin);
    return vaultEncryptionKey;
  } catch (error: unknown) {
    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes('locked after too many failed attempts')) {
        throw new PinLockedError();
      }

      // Extract attempts remaining from error message
      const attemptsMatch = error.message.match(/(\d+) attempts remaining/);
      if (attemptsMatch) {
        const attemptsRemaining = parseInt(attemptsMatch[1], 10);
        throw new IncorrectPinError(attemptsRemaining);
      }
    }

    console.error('[PinUnlockService] Failed to unlock with PIN:', error);
    throw error;
  }
}

/**
 * Disable PIN unlock and remove all stored (encrypted) data
 */
export async function removeAndDisablePin(): Promise<void> {
  try {
    await NativeVaultManager.removeAndDisablePin();
  } catch (error) {
    console.error('[PinUnlockService] Failed to disable PIN:', error);
    throw error;
  }
}
