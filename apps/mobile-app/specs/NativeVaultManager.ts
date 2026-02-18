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

  // WebAPI request execution
  executeWebApiRequest(method: string, endpoint: string, body: string | null, headers: string, requiresAuth: boolean): Promise<string>;

  // Vault state management
  isVaultUnlocked(): Promise<boolean>;
  getVaultMetadata(): Promise<string>;
  unlockVault(): Promise<boolean>;
  clearSession(): Promise<void>;  // Clears session only, preserves vault for potential RPO recovery
  clearVault(): Promise<void>;    // Clears everything including vault data

  // Vault sync - single method handles all sync logic including merge
  // Returns detailed result about what action was taken
  syncVaultWithServer(): Promise<{ success: boolean; action: 'uploaded' | 'downloaded' | 'merged' | 'already_in_sync' | 'error'; newRevision: number; wasOffline: boolean; error: string | null }>;

  // Quick check if sync is needed without doing the actual sync
  // Used to show appropriate UI indicator before starting sync
  checkSyncStatus(): Promise<{ success: boolean; hasNewerVault: boolean; hasDirtyChanges: boolean; isOffline: boolean; requiresLogout: boolean; errorKey: string | null }>;

  // Sync state management (kept for local mutation tracking)
  getSyncState(): Promise<{isDirty: boolean; mutationSequence: number; serverRevision: number; isSyncing: boolean}>;
  markVaultClean(mutationSeqAtStart: number, newServerRevision: number): Promise<boolean>;
  clearEncryptedVaultForFreshDownload(): Promise<void>;  // Deletes corrupted vault and resets sync state to force fresh download

  // Vault SQL operations
  executeQuery(query: string, params: (string | number | null)[]): Promise<string[]>;
  executeUpdate(query: string, params:(string | number | null)[]): Promise<number>;
  executeRaw(query: string): Promise<void>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  // Persist the in-memory database to encrypted storage and mark as dirty.
  // Used after migrations where SQL handles its own transactions but we need to persist and sync.
  persistAndMarkDirty(): Promise<void>;

  // Cryptography operations
  deriveKeyFromPassword(password: string, salt: string, encryptionType: string, encryptionSettings: string): Promise<string>;

  // Database/encryption key operations
  storeMetadata(metadata: string): Promise<void>;
  setAuthMethods(authMethods: string[]): Promise<void>;
  storeEncryptionKeyInMemory(base64EncryptionKey: string): Promise<void>;
  clearEncryptionKeyFromMemory(): Promise<void>;
  storeEncryptionKey(base64EncryptionKey: string): Promise<void>;
  storeEncryptionKeyDerivationParams(keyDerivationParams: string): Promise<void>;
  getEncryptionKeyDerivationParams(): Promise<string | null>;
  hasEncryptedDatabase(): Promise<boolean>;
  getEncryptedDatabase(): Promise<string | null>;

  // Auto-lock settings
  setAutoLockTimeout(timeout: number): Promise<void>;
  getAutoLockTimeout(): Promise<number>;
  getAuthMethods(): Promise<string[]>;
  openAutofillSettingsPage(): Promise<void>;
  getAutofillShowSearchText(): Promise<boolean>;
  setAutofillShowSearchText(showSearchText: boolean): Promise<void>;

  // Clipboard management
  copyToClipboardWithExpiration(text: string, expirationSeconds: number): Promise<void>;

  // Battery optimization management
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

  // SRP (Secure Remote Password) operations
  // These methods use the native Rust SRP implementation for secure authentication.
  // All hex values are uppercase strings.

  // Generate a 32-byte random salt as uppercase hex string
  srpGenerateSalt(): Promise<string>;

  // Derive SRP private key: x = H(salt | H(identity | ":" | passwordHash))
  // passwordHash should be uppercase hex string (from Argon2id derivation)
  srpDerivePrivateKey(salt: string, identity: string, passwordHash: string): Promise<string>;

  // Derive SRP verifier: v = g^x mod N (for registration)
  srpDeriveVerifier(privateKey: string): Promise<string>;

  // Generate client ephemeral key pair (public A and secret a)
  srpGenerateEphemeral(): Promise<{public: string; secret: string}>;

  // Derive client session from server response
  // Returns proof (M1) and shared key (K) as uppercase hex strings
  srpDeriveSession(clientSecret: string, serverPublic: string, salt: string, identity: string, privateKey: string): Promise<{proof: string; key: string}>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeVaultManager');
