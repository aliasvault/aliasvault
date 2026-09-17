import { TurboModuleRegistry } from 'react-native';

import type { TurboModule } from 'react-native';

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface Spec extends TurboModule {
  // WebAPI configuration and token management
  setApiUrl(url: string): Promise<void>;
  getApiUrl(): Promise<string>;
  setAuthTokens(accessToken: string, refreshToken: string): Promise<void>;
  getAccessToken(): Promise<string | null>;
  clearAuthTokens(): Promise<void>;
  revokeTokens(): Promise<void>;
  setCustomProxyHeaders(headersJson: string): Promise<void>;
  getCustomProxyHeaders(): Promise<string>;

  // WebAPI request execution against the v2 API base URL.
  executeWebApiRequest(method: string, endpoint: string, body: string | null, headers: string, requiresAuth: boolean): Promise<string>;

  // Vault state management
  isVaultUnlocked(): Promise<boolean>;
  getVaultMetadata(): Promise<string>;
  unlockVault(): Promise<boolean>;
  clearSession(): Promise<void>;  // Clears session only, preserves vault for potential RPO recovery
  clearVault(): Promise<void>;    // Clears everything including vault data

  // Rust core dispatch. The client core's Rust binding routes every call through here: `name` is the uniffi
  // function name in camelCase, `argsJson` a JSON array of its positional arguments (bytes as base64), and the
  // result is JSON text. Swift/Kotlin hold one case per function and no logic; see platform/NativeRustCore.ts.
  rustCall(name: string, argsJson: string): Promise<string>;

  // Store the encrypted vault blob for persistence and which is also accessed by the native autofill extensions.
  storeEncryptedDatabase(base64EncryptedDb: string): Promise<void>;

  // Vault sync.
  syncVaultWithServer(): Promise<{ success: boolean; action: 'uploaded' | 'downloaded' | 'merged' | 'already_in_sync' | 'error'; newRevision: number; wasOffline: boolean; error: string | null; errorMessage: string | null; sqliteBlobUpgradeRequired: boolean; manifestMigrationRequired: boolean }>;
  
  getVaultMigrationStatus(): Promise<string>;
  migrateVaultManifest(): Promise<{ success: boolean; pushed: boolean; error: string | null; errorMessage: string | null }>;

  // A sharing operation of the sync engine.
  runSharingOperation(operation: string, paramsJson: string): Promise<{ success: boolean; apiErrorCode: string | null; vaultUpgradeRequired: boolean; error: string | null; errorMessage: string | null }>;

  // Quick check if sync is needed
  checkSyncStatus(): Promise<{ success: boolean; hasNewerVault: boolean; hasDirtyChanges: boolean; isOffline: boolean; requiresLogout: boolean; errorKey: string | null }>;

  // Logs of the recent sync engine runs, for the developer tools.
  getVaultSyncLogs(): Promise<string>;

  // Sync state management
  getSyncState(): Promise<{isDirty: boolean; mutationSequence: number; serverRevision: number; isSyncing: boolean}>;
  markVaultClean(mutationSeqAtStart: number, newServerRevision: number): Promise<boolean>;
  clearEncryptedVaultForFreshDownload(): Promise<void>;

  // Vault SQL operations. executeQuery returns BLOB columns as base64 behind an "av-blob-base64:" prefix.
  executeQuery(query: string, params: (string | number | null)[]): Promise<string[]>;
  executeUpdate(query: string, params:(string | number | null)[]): Promise<number>;
  executeRaw(query: string): Promise<void>;
  beginTransaction(): Promise<void>;
  commitTransaction(scope: string): Promise<void>;
  rollbackTransaction(): Promise<void>;
  persistAndMarkDirty(scope: string): Promise<void>;

  // Cryptography operations
  deriveKeyFromPassword(password: string, salt: string, encryptionType: string, encryptionSettings: string): Promise<string>;

  // Database/encryption key operations
  storeMetadata(metadata: string): Promise<void>;
  setAuthMethods(authMethods: string[]): Promise<void>;
  storeUnlockKeyInMemory(base64UnlockKey: string): Promise<void>;
  clearEncryptionKeyFromMemory(): Promise<void>;
  storeUnlockKey(base64UnlockKey: string): Promise<void>;
  storeUnlockKeyDerivationParams(keyDerivationParams: string): Promise<void>;
  getUnlockKeyDerivationParams(): Promise<string | null>;
  storeAccountKeyChain(chainJson: string | null): Promise<void>;
  getAccountKeyChain(): Promise<string | null>;
  resolveVaultKey(base64DerivedKey: string): Promise<string>;
  getPersonalManifestId(): Promise<string | null>;
  hasEncryptedDatabase(): Promise<boolean>;
  getEncryptedDatabase(): Promise<string | null>;

  // Auto-lock settings
  setAutoLockTimeout(timeout: number): Promise<void>;
  getAutoLockTimeout(): Promise<number>;
  getAuthMethods(): Promise<string[]>;
  openAutofillSettingsPage(): Promise<void>;
  getAutofillShowSearchText(): Promise<boolean>;
  setAutofillShowSearchText(showSearchText: boolean): Promise<void>;
  getAutofillCopyTotpOnFill(): Promise<boolean>;
  setAutofillCopyTotpOnFill(enabled: boolean): Promise<void>;

  // Clipboard management
  copyToClipboardWithExpiration(text: string, expirationSeconds: number, localOnly: boolean): Promise<void>;

  // TOTP code generation via native layer.
  generateTotpCode(secret: string, algorithm: string, digits: number, period: number): Promise<string | null>;

  // Battery optimization management (Android only)
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): Promise<string>;

  // Credential identity management
  registerCredentialIdentities(): Promise<void>;
  removeCredentialIdentities(): Promise<void>;

  // Username management
  setUsername(username: string): Promise<void>;
  getUsername(): Promise<string | null>;
  clearUsername(): Promise<void>;

  // Offline mode management
  setOfflineMode(isOffline: boolean): Promise<void>;
  getOfflineMode(): Promise<boolean>;

  // Server version management
  isServerVersionGreaterThanOrEqualTo(targetVersion: string): Promise<boolean>;
  getServerVersion(): Promise<string | null>;

  // The capabilities the server resolved for this account as a JSON object, or null when no sync stored any yet.
  getCapabilities(): Promise<string | null>;

  // PIN unlock methods
  isPinEnabled(): Promise<boolean>;
  isKeystoreAvailable(): Promise<boolean>;

  // Whether the device has biometrics that can protect the vault key. On Android the key
  // requires Class 3 (strong) biometrics, so devices with only Class 2 (weak) biometrics
  // such as camera-based face unlock return false here.
  isBiometricsAvailableOnDevice(): Promise<boolean>;

  // Biometric unlock validation - checks if biometric unlock is actually available
  // Returns true only if device supports biometrics AND the encryption key is valid
  // Returns false if key has been invalidated (e.g., biometric enrollment changed)
  isBiometricUnlockAvailable(): Promise<boolean>;

  removeAndDisablePin(): Promise<void>;
  showPinUnlock(): Promise<void>;
  showPinSetup(): Promise<void>;

  // Password unlock method. Shows native password unlock screen.
  // Returns true if successful, null if cancelled.
  // If title/subtitle are null/empty, defaults to "Unlock Vault" context.
  // If buttonText is null/empty, defaults to "Unlock".
  showPasswordUnlock(title: string | null, subtitle: string | null, buttonText: string | null): Promise<boolean | null>;

  // Mobile login methods
  encryptDecryptionKeyForMobileLogin(publicKeyJWK: string): Promise<string>;

  // Re-authentication methods
  // Authenticate user with biometric or PIN. If title/subtitle are null/empty, defaults to "Unlock Vault" context.
  // allowedMethods: Optional array of allowed methods ('biometric', 'pin', 'password'). If null/empty, all enabled methods are allowed.
  // buttonText: Optional custom text for the unlock/confirm button. If null/empty, defaults to "Unlock".
  // recentUnlockGraceSeconds: If > 0, skip the prompt when a successful biometric or PIN unlock happened within this many seconds ago. Pass 0 to always prompt.
  authenticateUser(title: string | null, subtitle: string | null, allowedMethods: string[] | null, buttonText: string | null, recentUnlockGraceSeconds: number): Promise<boolean>;

  // Answer a server's SRP challenge with the available unlock key.
  deriveSrpProof(salt: string, srpIdentity: string, serverEphemeral: string): Promise<{ clientPublicEphemeral: string; clientSessionProof: string }>;

  // QR code scanner
  // Scan a QR code and return the scanned data. Returns null if cancelled or failed.
  // If prefixes is provided, only QR codes starting with one of these prefixes will be accepted.
  // Scanner will keep scanning until a matching code is found or user cancels.
  // statusText is the message to display on the scanner screen (defaults to "Scan QR code" if null/empty).
  scanQRCode(prefixes: string[] | null, statusText: string | null): Promise<string | null>;

  // App store review prompt
  // Whether this platform can ask for a store review. Android is not implemented yet.
  isAppReviewAvailable(): Promise<boolean>;
  // Ask the OS to show its native review prompt.
  requestAppReview(): Promise<boolean>;
  // The install date as a unix timestamp in milliseconds, or 0 when it cannot be determined.
  getAppInstallDate(): Promise<number>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeVaultManager');
