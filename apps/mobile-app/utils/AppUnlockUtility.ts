import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import NativeVaultManager from '@/specs/NativeVaultManager';
import i18n from '@/i18n';

export type AuthMethod = 'faceid' | 'password';

/**
 * Comprehensive utility for all app unlock-related functionality.
 * Centralizes biometric availability checks, display name logic, auth method management,
 * and unlock configuration.
 */
export class AppUnlockUtility {
  /**
   * Get enabled auth methods from the native module.
   * Filters out Face ID if biometrics are not enrolled.
   */
  static async getEnabledAuthMethods(): Promise<AuthMethod[]> {
    try {
      let methods = await NativeVaultManager.getAuthMethods() as AuthMethod[];
      // Check if Face ID is actually available despite being enabled
      if (methods.includes('faceid')) {
        const isAvailable = await this.isBiometricsAvailableOnDevice();
        if (!isAvailable) {
          // Remove Face ID from the list of enabled auth methods
          methods = methods.filter(method => method !== 'faceid');
        }
      }
      return methods;
    } catch (error) {
      console.error('Failed to get enabled auth methods:', error);
      return ['password'];
    }
  }

  /**
   * Set the authentication methods and save them to native storage.
   * Always ensures password is included as a fallback.
   */
  static async setAuthMethods(methods: AuthMethod[]): Promise<void> {
    // Ensure password is always included
    const methodsToSave = methods.includes('password') ? methods : [...methods, 'password'];

    // Update native credentials manager
    try {
      await NativeVaultManager.setAuthMethods(methodsToSave);
    } catch (error) {
      console.error('Failed to update native auth methods:', error);
      throw error;
    }
  }

  /**
   * Enable an authentication method by adding it to the current auth methods.
   * This handles getting current methods, adding the new one, and saving.
   */
  static async enableAuthMethod(method: AuthMethod): Promise<void> {
    try {
      const currentMethods = await this.getEnabledAuthMethods();
      if (!currentMethods.includes(method)) {
        await this.setAuthMethods([...currentMethods, method]);
      }
    } catch (error) {
      console.error(`Failed to enable auth method ${method}:`, error);
      throw error;
    }
  }

  /**
   * Disable an authentication method by removing it from the current auth methods.
   * This handles getting current methods, removing the specified one, and saving.
   * Password cannot be disabled as it's always required as a fallback.
   */
  static async disableAuthMethod(method: AuthMethod): Promise<void> {
    if (method === 'password') {
      console.warn('Cannot disable password auth method - it is always required');
      return;
    }

    try {
      const currentMethods = await this.getEnabledAuthMethods();
      const updatedMethods = currentMethods.filter(m => m !== method);
      await this.setAuthMethods(updatedMethods);
    } catch (error) {
      console.error(`Failed to disable auth method ${method}:`, error);
      throw error;
    }
  }
  /**
   * Check if biometrics are available on the device (hardware + enrollment).
   * This only checks device capabilities, not key validity.
   */
  static async isBiometricsAvailableOnDevice(): Promise<boolean> {
    try {
      return await NativeVaultManager.isBiometricsAvailableOnDevice();
    } catch (error) {
      console.error('Error checking biometric device availability:', error);
      return false;
    }
  }

  /**
   * Check if biometric unlock is actually available and functional.
   * This performs comprehensive validation:
   * - Device has biometric hardware
   * - Biometrics are enrolled
   * - Biometrics are enabled in auth methods
   * - Encryption key in native KeyStore/Keychain is valid
   *
   * Returns false if the key has been invalidated (e.g., biometric enrollment changed).
   * Use this method when determining whether to show biometric unlock UI.
   *
   * IMPORTANT: If the key is invalid but 'faceid' is still in auth methods,
   * this method will automatically remove it to keep state consistent.
   */
  static async isBiometricUnlockAvailable(): Promise<boolean> {
    try {
      // First check device capabilities
      const deviceAvailable = await this.isBiometricsAvailableOnDevice();
      if (!deviceAvailable) {
        return false;
      }

      // Then validate that biometric unlock is actually functional
      // This checks auth methods AND validates the encryption key
      const isAvailable = await NativeVaultManager.isBiometricUnlockAvailable();

      // If biometric unlock is NOT available but 'faceid' is still in auth methods,
      // automatically remove it to keep state consistent
      if (!isAvailable) {
        const currentMethods = await this.getEnabledAuthMethods();
        if (currentMethods.includes('faceid')) {
          console.log('Biometric key invalid but faceid still in auth methods - cleaning up');
          const methodsWithoutBiometric = currentMethods.filter(m => m !== 'faceid');
          await this.setAuthMethods(methodsWithoutBiometric);
        }
      }

      return isAvailable;
    } catch (error) {
      console.error('Error checking biometric unlock availability:', error);
      return false;
    }
  }

  /**
   * Get the appropriate biometric display name translation key based on device capabilities.
   * Returns localization keys like 'settings.vaultUnlockSettings.faceId', 'biometrics', etc.
   */
  static async getBiometricDisplayName(): Promise<string> {
    try {
      const hasBiometrics = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();

      // For Android, we use the term "Biometrics" for facial recognition and fingerprint.
      if (Platform.OS === 'android') {
        return i18n.t('settings.vaultUnlockSettings.biometrics');
      }

      // For iOS, we check if the device has explicit Face ID or Touch ID support.
      if (!hasBiometrics || !enrolled) {
        return i18n.t('settings.vaultUnlockSettings.faceIdTouchId');
      }

      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFaceIDSupport = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const hasTouchIDSupport = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);

      if (hasFaceIDSupport) {
        return i18n.t('settings.vaultUnlockSettings.faceId');
      } else if (hasTouchIDSupport) {
        return i18n.t('settings.vaultUnlockSettings.touchId');
      }

      return i18n.t('settings.vaultUnlockSettings.faceIdTouchId');
    } catch (error) {
      console.error('Failed to get biometric display name:', error);
      return i18n.t('settings.vaultUnlockSettings.faceIdTouchId');
    }
  }

  /**
   * Get the display label translation key for the current auth method.
   * Priority: Biometrics > PIN > Password
   *
   * @returns Translation key for the primary unlock method
   */
  static async getAuthMethodDisplayKey(): Promise<string> {
    try {
      // Check for biometrics first (highest priority)
      const methods = await this.getEnabledAuthMethods();
      if (methods.includes('faceid')) {
        if (await this.isBiometricUnlockAvailable()) {
          return await this.getBiometricDisplayName();
        }
      }

      // Check for PIN (second priority)
      const pinEnabled = await NativeVaultManager.isPinEnabled();
      if (pinEnabled) {
        return 'settings.vaultUnlockSettings.pin';
      }

      // Fallback to password
      return 'items.password';
    } catch (error) {
      console.error('Failed to get auth method display key:', error);
      return 'items.password';
    }
  }
}
