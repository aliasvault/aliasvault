import { TurboModuleRegistry } from 'react-native';

import type { TurboModule } from 'react-native';

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface Spec extends TurboModule {
  // Basic credential operations
  clearVault(): Promise<void>;

  // Vault state management
  isVaultUnlocked(): Promise<boolean>;
  getVaultMetadata(): Promise<string>;
  unlockVault(): Promise<boolean>;

  // Cryptography operations
  deriveKeyFromPassword(password: string, salt: string, encryptionType: string, encryptionSettings: string): Promise<string>;

  // Database operations
  storeDatabase(base64EncryptedDb: string): Promise<void>;
  storeMetadata(metadata: string): Promise<void>;
  setAuthMethods(authMethods: string[]): Promise<void>;
  storeEncryptionKey(base64EncryptionKey: string): Promise<void>;
  storeEncryptionKeyDerivationParams(keyDerivationParams: string): Promise<void>;
  getEncryptionKeyDerivationParams(): Promise<string | null>;
  hasEncryptedDatabase(): Promise<boolean>;
  getEncryptedDatabase(): Promise<string | null>;
  getCurrentVaultRevisionNumber(): Promise<number>;
  setCurrentVaultRevisionNumber(revisionNumber: number): Promise<void>;

  // SQL operations
  executeQuery(query: string, params: (string | number | null)[]): Promise<string[]>;
  executeUpdate(query: string, params:(string | number | null)[]): Promise<number>;
  executeRaw(query: string): Promise<void>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;

  // Auto-lock settings
  setAutoLockTimeout(timeout: number): Promise<void>;
  getAutoLockTimeout(): Promise<number>;
  getAuthMethods(): Promise<string[]>;
  openAutofillSettingsPage(): Promise<void>;
  getAutofillShowSearchText(): Promise<boolean>;
  setAutofillShowSearchText(showSearchText: boolean): Promise<void>;

  // Clipboard management
  clearClipboardAfterDelay(delayInSeconds: number): Promise<void>;
  copyToClipboardWithExpiration(text: string, expirationSeconds: number): Promise<void>;

  // Exact alarm permission management
  canScheduleExactAlarms(): Promise<boolean>;
  requestExactAlarmPermission(): Promise<string>;

  // Battery optimization management
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): Promise<string>;

  // Credential identity management
  registerCredentialIdentities(): Promise<void>;
  removeCredentialIdentities(): Promise<void>;

  // WebAPI configuration and token management
  setApiUrl(url: string): Promise<void>;
  getApiUrl(): Promise<string>;
  setAuthTokens(accessToken: string, refreshToken: string): Promise<void>;
  getAccessToken(): Promise<string | null>;
  clearAuthTokens(): Promise<void>;
  revokeTokens(): Promise<void>;

  // WebAPI request execution
  executeWebApiRequest(
    method: string,
    endpoint: string,
    body: string | null,
    headers: string,
    requiresAuth: boolean
  ): Promise<string>;

  // Username management
  setUsername(username: string): Promise<void>;
  getUsername(): Promise<string | null>;
  clearUsername(): Promise<void>;

  // Offline mode management
  setOfflineMode(isOffline: boolean): Promise<void>;
  getOfflineMode(): Promise<boolean>;

  // Server version management
  isServerVersionGreaterThanOrEqualTo(targetVersion: string): Promise<boolean>;

  // Vault sync and mutate
  isNewVaultVersionAvailable(): Promise<{ isNewVersionAvailable: boolean; newRevision: number | null }>;
  downloadVault(newRevision: number): Promise<boolean>;
  mutateVault(): Promise<boolean>;

  // PIN unlock methods
  isPinEnabled(): Promise<boolean>;
  removeAndDisablePin(): Promise<void>;
  showPinUnlock(): Promise<void>;
  showPinSetup(): Promise<void>;

  // Mobile login methods
  encryptDecryptionKeyForMobileLogin(publicKeyJWK: string): Promise<string>;

  // Re-authentication methods
  // Authenticate user with biometric or PIN. If title/subtitle are null/empty, defaults to "Unlock Vault" context.
  authenticateUser(title: string | null, subtitle: string | null): Promise<boolean>;

  // QR code scanner
  // Scan a QR code and return the scanned data. Returns null if cancelled or failed.
  // If prefixes is provided, only QR codes starting with one of these prefixes will be accepted.
  // Scanner will keep scanning until a matching code is found or user cancels.
  // statusText is the message to display on the scanner screen (defaults to "Scan QR code" if null/empty).
  scanQRCode(prefixes: string[] | null, statusText: string | null): Promise<string | null>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeVaultManager');
