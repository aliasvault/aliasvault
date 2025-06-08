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
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;

  // Auto-lock settings
  setAutoLockTimeout(timeout: number): Promise<void>;
  getAutoLockTimeout(): Promise<number>;
  getAuthMethods(): Promise<string[]>;
  openAutofillSettingsPage(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NativeVaultManager');
