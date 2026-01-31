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
   * Priority: Biometric -> PIN -> Manual unlock
   * If biometric fails/is cancelled and PIN is enabled, automatically falls back to PIN.
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
        if (isUnlocked) {
          return { success: true };
        }
        // Biometric failed - fall through to PIN fallback below
        console.log('Biometric unlock returned false, trying PIN fallback if available');
      } catch (error) {
        // Biometric error - fall through to PIN fallback below
        console.error('Biometric unlock error:', error);
      }

      // Biometric failed or was cancelled - try PIN fallback if available
      if (isPinEnabled) {
        return this.attemptPinUnlock();
      }

      // No PIN fallback available
      return {
        success: false,
        error: 'Biometric unlock failed',
        redirectToUnlock: true,
      };
    }

    // Biometric not enabled - try PIN unlock directly
    if (isPinEnabled) {
      return this.attemptPinUnlock();
    }

    // No automatic unlock method available - manual unlock required
    return {
      success: false,
      error: 'No automatic unlock method available',
      redirectToUnlock: true,
    };
  }

  /**
   * Attempt PIN unlock.
   * @returns Promise<UnlockResult> indicating success/failure
   */
  private static async attemptPinUnlock(): Promise<UnlockResult> {
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
      const errorMessage = error instanceof Error ? error.message : 'PIN unlock failed or cancelled';
      if (!errorMessage.includes('cancelled') && !errorMessage.includes('canceled')) {
        console.error('PIN unlock error:', error);
      }
      return {
        success: false,
        error: errorMessage,
        redirectToUnlock: true,
      };
    }
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
