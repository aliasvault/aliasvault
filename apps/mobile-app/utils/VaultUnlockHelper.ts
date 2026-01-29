import NativeVaultManager from '@/specs/NativeVaultManager';

export type AuthMethod = 'faceid' | 'password';

export type UnlockResult = {
  success: boolean;
  error?: string;
  redirectToUnlock?: boolean;
};

/**
 * Centralized vault unlock logic that handles both biometric and PIN unlock.
 * This utility is used by initialize.tsx, reinitialize.tsx, and unlock.tsx to avoid code duplication.
 */
export class VaultUnlockHelper {
  /**
   * Attempt to unlock the vault using available authentication methods.
   * Tries biometric first (if available), then PIN (if enabled), otherwise indicates manual unlock needed.
   *
   * @param params Configuration for unlock attempt
   * @returns Promise<UnlockResult> indicating success/failure and any actions needed
   */
  static async attemptAutomaticUnlock(params: {
    enabledAuthMethods: AuthMethod[];
    unlockVault: () => Promise<boolean>; // dbContext.unlockVault for biometric
  }): Promise<UnlockResult> {
    const { enabledAuthMethods, unlockVault } = params;

    // Check which authentication methods are available
    const isFaceIDEnabled = enabledAuthMethods.includes('faceid');
    const isPinEnabled = await NativeVaultManager.isPinEnabled();

    // Try biometric unlock first (Face ID / Touch ID)
    if (isFaceIDEnabled) {
      try {
        const isUnlocked = await unlockVault();
        if (!isUnlocked) {
          return {
            success: false,
            error: 'Biometric unlock failed',
            redirectToUnlock: true,
          };
        }
        return { success: true };
      } catch (error) {
        console.error('Biometric unlock error:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Biometric unlock failed',
          redirectToUnlock: true,
        };
      }
    }

    // Try PIN unlock if biometric is not available
    if (isPinEnabled) {
      try {
        await NativeVaultManager.showPinUnlock();

        // Verify vault is now unlocked
        const isNowUnlocked = await NativeVaultManager.isVaultUnlocked();
        if (!isNowUnlocked) {
          return {
            success: false,
            error: 'PIN unlock failed',
            redirectToUnlock: true,
          };
        }
        return { success: true };
      } catch (error) {
        // User cancelled or PIN unlock failed
        // Only log non-cancellation errors to reduce noise
        const errorMessage = error instanceof Error ? error.message : 'PIN unlock failed or cancelled';
        if (!errorMessage.includes('cancelled')) {
          console.error('PIN unlock error:', error);
        }
        return {
          success: false,
          error: errorMessage,
          redirectToUnlock: true,
        };
      }
    }

    // No automatic unlock method available - manual unlock required
    return {
      success: false,
      error: 'No automatic unlock method available',
      redirectToUnlock: true,
    };
  }

  /**
   * Authenticate user for a specific action (e.g., mobile unlock confirmation).
   * Uses the native authenticateUser which automatically detects and uses the appropriate method.
   *
   * @param title Authentication prompt title
   * @param subtitle Authentication prompt subtitle
   * @returns Promise<boolean> indicating if authentication succeeded
   */
  static async authenticateForAction(
    title: string,
    subtitle: string
  ): Promise<boolean> {
    try {
      const authenticated = await NativeVaultManager.authenticateUser(title, subtitle);
      return authenticated;
    } catch (error) {
      console.error('Authentication error:', error);
      return false;
    }
  }

  /**
   * Check if any automatic unlock method is available.
   * @param enabledAuthMethods The enabled authentication methods
   * @returns Promise<boolean> indicating if automatic unlock is possible
   */
  static async hasAutomaticUnlockMethod(
    enabledAuthMethods: AuthMethod[]
  ): Promise<boolean> {
    const isFaceIDEnabled = enabledAuthMethods.includes('faceid');
    const isPinEnabled = await NativeVaultManager.isPinEnabled();
    return isFaceIDEnabled || isPinEnabled;
  }
}
