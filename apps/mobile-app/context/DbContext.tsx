import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

import type { UnlockKeyDerivationParams, VaultMetadata } from '@aliasvault/models/metadata';
import { hasUserVisibleScope, type VaultMutationScope } from '@aliasvault/client/sync/VaultMutationScope';
import EncryptionUtility from '@/utils/EncryptionUtility';
import SqliteClient from '@/utils/SqliteClient';

import NativeVaultManager from '@/specs/NativeVaultManager';

type DbContextType = {
  sqliteClient: SqliteClient | null;
  dbInitialized: boolean;
  dbAvailable: boolean;
  // Sync state tracking
  isDirty: boolean;
  /**
   * Whether the pending changes are worth telling the user about. A vault that is only dirty from silent
   * scopes (e.g. item usage statistics recorded while autofilling) syncs like any other but reports false
   * here, so the UI stays quiet about writes the user never asked for.
   */
  hasUnsyncedUserChanges: boolean;
  isSyncing: boolean;
  isUploading: boolean;
  isOffline: boolean;
  setIsSyncing: (syncing: boolean) => void;
  setIsUploading: (uploading: boolean) => void;
  setIsOffline: (offline: boolean) => Promise<void>;
  /**
   * Check if email errors should be suppressed.
   * Errors are suppressed when vault has local changes not yet synced,
   * as the server may not know about newly created items/aliases yet.
   */
  shouldSuppressEmailErrors: () => boolean;
  refreshSyncState: () => Promise<void>;
  storeUnlockKey: (derivedKey: string) => Promise<void>;
  storeUnlockKeyDerivationParams: (keyDerivationParams: UnlockKeyDerivationParams) => Promise<void>;
  requiresLegacySqliteBlobMigration: () => Promise<boolean>;
  hasPendingMigrations: () => Promise<boolean>;
  clearDatabase: () => void;
  getVaultMetadata: () => Promise<VaultMetadata | null>;
  testDatabaseConnection: (derivedKey: string, persistToKeychain?: boolean) => Promise<boolean>;
  verifyUnlockKey: (derivedKey: string) => Promise<boolean>;
  unlockVault: () => Promise<boolean>;
  checkStoredVault: () => Promise<void>;
  setDatabaseAvailable: () => void;
}

const DbContext = createContext<DbContextType | undefined>(undefined);

/**
 * DbProvider to provide the SQLite client to the app that components can use to make database queries.
 */
export const DbProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  /**
   * SQLite client is initialized in constructor as it passes SQL queries to the native module.
   */
  const sqliteClient = useMemo(() => new SqliteClient(), []);

  /**
   * Database initialization state. If true, the database has been initialized and the dbAvailable state is correct.
   */
  const [dbInitialized, setDbInitialized] = useState(false);

  /**
   * Database availability state. If true, the database is available. If false, the database is not available and needs to be unlocked or retrieved again from the API.
   */
  const [dbAvailable, setDbAvailable] = useState(false);

  /**
   * Sync state tracking - isDirty indicates local changes not yet uploaded to server.
   */
  const [isDirty, setIsDirty] = useState(false);

  /**
   * Sync state tracking - the scopes those local changes belong to, which decides what the UI shows.
   */
  const [dirtyScopes, setDirtyScopes] = useState<VaultMutationScope[]>([]);

  /**
   * Sync state tracking - isSyncing indicates a download sync operation is in progress.
   */
  const [isSyncing, setIsSyncingState] = useState(false);

  /**
   * Sync state tracking - isUploading indicates an upload operation is in progress.
   */
  const [isUploading, setIsUploadingState] = useState(false);

  /**
   * Offline mode state - indicates network is unavailable.
   */
  const [isOffline, setIsOfflineState] = useState(false);

  /**
   * Check if email errors should be suppressed.
   * Errors are suppressed when vault has local changes not yet synced,
   * as the server may not know about newly created items/aliases yet.
   */
  const shouldSuppressEmailErrors = useCallback(() => {
    return isDirty || isSyncing;
  }, [isDirty, isSyncing]);

  /**
   * Unlock the vault in the native module which will decrypt the database using the stored encryption key
   * and load it into memory.
   *
   * @throws Error with error code if unlock fails - caller should handle the error and display appropriate message
   */
  const unlockVault = useCallback(async () : Promise<boolean> => {
    await NativeVaultManager.unlockVault();
    return true;
  }, []);

  /**
   * Store the unlock key (the password-derived KEK) in the Native module (in memory and optionally keychain). The
   * native module opens the account key chain with it, which gives the vault encryption key of the session.
   *
   * @param derivedKey The password-derived unlock key
   */
  const storeUnlockKey = useCallback(async (derivedKey: string) => {
    await sqliteClient.storeUnlockKey(derivedKey
    );
  }, [sqliteClient]);

  /**
   * Store the key derivation parameters in the Native module (in memory and optionally keychain).
   *
   * @param keyDerivationParams The key derivation parameters
   */
  const storeUnlockKeyDerivationParams = useCallback(async (keyDerivationParams: UnlockKeyDerivationParams) => {
    await sqliteClient.storeUnlockKeyDerivationParams(keyDerivationParams);
  }, [sqliteClient]);

  /**
   * Whether the vault still has to walk the legacy sqlite-blob upgrade chain (pre-2.0.0). Throws when the vault version
   * is unknown to this app, which makes the caller log out.
   */
  const requiresLegacySqliteBlobMigration = useCallback(async () => {
    return await sqliteClient.requiresLegacySqliteBlobMigration();
  }, [sqliteClient]);

  /**
   * Whether the vault has to go through the upgrade page before any other page may query it: the legacy sqlite-blob
   * chain, a schema older than this app's, or an account without its key hierarchy yet (the manifest migration). The
   * upgrade page classifies which applies. Throws when the vault version is unknown to this app, which makes the caller log out.
   */
  const hasPendingMigrations = useCallback(async () => {
    if (await sqliteClient.requiresLegacySqliteBlobMigration()) {
      return true;
    }

    return await sqliteClient.requiresSchemaMigration() || (await NativeVaultManager.getAccountKeyChain()) === null;
  }, [sqliteClient]);

  const checkStoredVault = useCallback(async () => {
    try {
      const hasEncryptedDatabase = await NativeVaultManager.hasEncryptedDatabase();
      if (hasEncryptedDatabase) {
        // Get metadata from SQLite client
        const metadata = await sqliteClient.getVaultMetadata();
        if (metadata) {
          // Vault metadata found, set database initialization state
          setDbInitialized(true);
          setDbAvailable(true);
        } else {
          // Vault metadata not found, set database initialization state
          setDbInitialized(true);
          setDbAvailable(false);
        }
      } else {
        // Vault not initialized, set database initialization state
        setDbInitialized(true);
        setDbAvailable(false);
      }
    } catch {
      // Error checking vault initialization, set database initialization state
      setDbInitialized(true);
      setDbAvailable(false);
    }
  }, [sqliteClient]);

  /**
   * Check if database is initialized and try to retrieve vault from background
   */
  useEffect(() : void => {
    if (!dbInitialized) {
      checkStoredVault();
    }
  }, [dbInitialized, checkStoredVault]);

  /**
   * Clear database and remove from native module, called when logging out.
   */
  const clearDatabase = useCallback(() : void => {
    EncryptionUtility.clearRsaPrivateKeyCache();
    setDbInitialized(false);
    NativeVaultManager.clearVault();
  }, []);

  /**
   * Manually set the database as available. Used after vault sync to immediately
   * mark the database as ready without file system checks.
   */
  const setDatabaseAvailable = useCallback(() : void => {
    setDbInitialized(true);
    setDbAvailable(true);
  }, []);

  /**
   * Refresh sync state from native layer. Call this after mutations or sync operations.
   */
  const refreshSyncState = useCallback(async (): Promise<void> => {
    try {
      const syncState = await NativeVaultManager.getSyncState();
      const offline = await NativeVaultManager.getOfflineMode();
      setIsDirty(syncState.isDirty);
      setDirtyScopes(syncState.dirtyScopes as VaultMutationScope[]);
      setIsOfflineState(offline);
    } catch (error) {
      console.error('Failed to refresh sync state:', error);
    }
  }, []);

  /**
   * Refresh sync state when database becomes available.
   * This ensures isDirty is populated from native storage on app boot,
   * so ServerSyncIndicator shows pending changes from previous sessions.
   */
  useEffect(() : void => {
    if (dbAvailable) {
      void refreshSyncState();
    }
  }, [dbAvailable, refreshSyncState]);

  /**
   * Set syncing state - exposed for use by sync hooks.
   */
  const setIsSyncing = useCallback((syncing: boolean): void => {
    setIsSyncingState(syncing);
  }, []);

  /**
   * Set uploading state - exposed for use by sync hooks.
   */
  const setIsUploading = useCallback((uploading: boolean): void => {
    setIsUploadingState(uploading);
  }, []);

  /**
   * Set offline mode and persist to native layer.
   */
  const setIsOffline = useCallback(async (offline: boolean): Promise<void> => {
    setIsOfflineState(offline);
    await NativeVaultManager.setOfflineMode(offline);
  }, []);

  /**
   * Get the current vault metadata directly from SQLite client
   */
  const getVaultMetadata = useCallback(async () : Promise<VaultMetadata | null> => {
    return await sqliteClient.getVaultMetadata();
  }, [sqliteClient]);

  /**
   * Test if the database is working with the provided (to be stored) unlock key by performing a simple query.
   * Uses two-step process: first init key in memory, verify it works, then persist to keystore.
   * This prevents overwriting a valid key with an invalid one if user enters wrong password.
   * @param derivedKey The unlock key (the password-derived KEK) to test with
   * @returns true if the database is working
   * @throws Error with error code if unlock fails - caller should handle the error
   */
  const testDatabaseConnection = useCallback(async (derivedKey: string, persistToKeychain = true): Promise<boolean> => {
    await sqliteClient.storeUnlockKeyInMemory(derivedKey);

    await unlockVault();

    const version = await sqliteClient.getDatabaseVersion();
    if (version && version.version && version.version.length > 0) {
      /*
       * Key is valid: optionally store in keychain.
       * When persistToKeychain=false, only store in memory. This is used during password unlock
       * when biometric authentication is unavailable (user cancelled or failed biometric prompt).
       * Storing in keychain requires biometric auth, which the user can't provide at that moment.
       * The old key in keychain is preserved for future biometric unlocks.
       */
      if (persistToKeychain) {
        await sqliteClient.storeUnlockKey(derivedKey);
      }
      return true;
    }

    return false;
  }, [sqliteClient, unlockVault]);

  /**
   * Verify if the provided unlock key is valid.
   * @param derivedKey The unlock key (the password-derived KEK) to verify
   * @returns true if the key is valid, false if invalid (wrong password)
   */
  const verifyUnlockKey = useCallback(async (derivedKey: string): Promise<boolean> => {
    try {
      await sqliteClient.storeUnlockKeyInMemory(derivedKey);
      await unlockVault();

      const version = await sqliteClient.getDatabaseVersion();
      return !!(version && version.version && version.version.length > 0);
    } catch (error) {
      // Unlock failed - likely wrong password/key
      console.error('verifyUnlockKey failed:', error);
      return false;
    }
  }, [sqliteClient, unlockVault]);

  const contextValue = useMemo(() => ({
    sqliteClient,
    dbInitialized,
    dbAvailable,
    // Sync state
    isDirty,
    hasUnsyncedUserChanges: isDirty && hasUserVisibleScope(dirtyScopes),
    isSyncing,
    isUploading,
    isOffline,
    setIsSyncing,
    setIsUploading,
    setIsOffline,
    shouldSuppressEmailErrors,
    refreshSyncState,
    requiresLegacySqliteBlobMigration,
    hasPendingMigrations,
    clearDatabase,
    getVaultMetadata,
    testDatabaseConnection,
    verifyUnlockKey,
    unlockVault,
    storeUnlockKey,
    storeUnlockKeyDerivationParams,
    checkStoredVault,
    setDatabaseAvailable,
  }), [sqliteClient, dbInitialized, dbAvailable, isDirty, dirtyScopes, isSyncing, isUploading, isOffline, setIsSyncing, setIsUploading, setIsOffline, shouldSuppressEmailErrors, refreshSyncState, requiresLegacySqliteBlobMigration, hasPendingMigrations, clearDatabase, getVaultMetadata, testDatabaseConnection, verifyUnlockKey, unlockVault, storeUnlockKey, storeUnlockKeyDerivationParams, checkStoredVault, setDatabaseAvailable]);

  return (
    <DbContext.Provider value={contextValue}>
      {children}
    </DbContext.Provider>
  );
};

/**
 * Hook to use the DbContext
 */
export const useDb = () : DbContextType => {
  const context = useContext(DbContext);
  if (context === undefined) {
    throw new Error('useDb must be used within a DbProvider');
  }
  return context;
};
