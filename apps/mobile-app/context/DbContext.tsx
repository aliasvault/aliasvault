import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

import type { EncryptionKeyDerivationParams, VaultMetadata } from '@/utils/dist/core/models/metadata';
import SqliteClient from '@/utils/SqliteClient';

import NativeVaultManager from '@/specs/NativeVaultManager';

type DbContextType = {
  sqliteClient: SqliteClient | null;
  dbInitialized: boolean;
  dbAvailable: boolean;
  // Sync state tracking
  isDirty: boolean;
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
  storeEncryptionKey: (derivedKey: string) => Promise<void>;
  storeEncryptionKeyDerivationParams: (keyDerivationParams: EncryptionKeyDerivationParams) => Promise<void>;
  hasPendingMigrations: () => Promise<boolean>;
  clearDatabase: () => void;
  getVaultMetadata: () => Promise<VaultMetadata | null>;
  testDatabaseConnection: (derivedKey: string) => Promise<boolean>;
  verifyEncryptionKey: (derivedKey: string) => Promise<boolean>;
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
   * Store the encryption key in the Native module (in memory and optionally keychain).
   *
   * @param derivedKey The derived encryption key
   * @param keyDerivationParams The key derivation parameters (used for deriving the encryption key from the plain text password in the unlock screen)
   */
  const storeEncryptionKey = useCallback(async (derivedKey: string) => {
    await sqliteClient.storeEncryptionKey(derivedKey
    );
  }, [sqliteClient]);

  /**
   * Store the key derivation parameters in the Native module (in memory and optionally keychain).
   *
   * @param keyDerivationParams The key derivation parameters
   */
  const storeEncryptionKeyDerivationParams = useCallback(async (keyDerivationParams: EncryptionKeyDerivationParams) => {
    await sqliteClient.storeEncryptionKeyDerivationParams(keyDerivationParams);
  }, [sqliteClient]);

  /**
   * Check if there are any pending migrations. This method also checks if the current vault version is known to the client.
   * If the current vault version is not known to the client, the method will throw an exception which causes the app to logout.
   */
  const hasPendingMigrations = useCallback(async () => {
    const currentVersion = await sqliteClient.getDatabaseVersion();
    const latestVersion = await sqliteClient.getLatestDatabaseVersion();

    return currentVersion.revision < latestVersion.revision;
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
      setIsDirty(syncState.isDirty);
      // Also refresh offline mode from native
      const offline = await NativeVaultManager.getOfflineMode();
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
   * Test if the database is working with the provided (to be stored) encryption key by performing a simple query.
   * Uses two-step process: first init key in memory, verify it works, then persist to keystore.
   * This prevents overwriting a valid key with an invalid one if user enters wrong password.
   * @param derivedKey The encryption key to test with
   * @returns true if the database is working
   * @throws Error with error code if unlock fails - caller should handle the error
   */
  const testDatabaseConnection = useCallback(async (derivedKey: string): Promise<boolean> => {
    await sqliteClient.storeEncryptionKeyInMemory(derivedKey);

    await unlockVault();

    const version = await sqliteClient.getDatabaseVersion();
    if (version && version.version && version.version.length > 0) {
      // Key is valid: store in keychain (possibly overwriting a previous entry)
      await sqliteClient.storeEncryptionKey(derivedKey);
      return true;
    }

    return false;
  }, [sqliteClient, unlockVault]);

  /**
   * Verify if the provided encryption key is valid.
   * @param derivedKey The encryption key to verify
   * @returns true if the key is valid, false if invalid (wrong password)
   */
  const verifyEncryptionKey = useCallback(async (derivedKey: string): Promise<boolean> => {
    try {
      await sqliteClient.storeEncryptionKeyInMemory(derivedKey);
      await unlockVault();

      const version = await sqliteClient.getDatabaseVersion();
      return !!(version && version.version && version.version.length > 0);
    } catch (error) {
      // Unlock failed - likely wrong password/key
      console.error('verifyEncryptionKey failed:', error);
      return false;
    }
  }, [sqliteClient, unlockVault]);

  const contextValue = useMemo(() => ({
    sqliteClient,
    dbInitialized,
    dbAvailable,
    // Sync state
    isDirty,
    isSyncing,
    isUploading,
    isOffline,
    setIsSyncing,
    setIsUploading,
    setIsOffline,
    shouldSuppressEmailErrors,
    refreshSyncState,
    hasPendingMigrations,
    clearDatabase,
    getVaultMetadata,
    testDatabaseConnection,
    verifyEncryptionKey,
    unlockVault,
    storeEncryptionKey,
    storeEncryptionKeyDerivationParams,
    checkStoredVault,
    setDatabaseAvailable,
  }), [sqliteClient, dbInitialized, dbAvailable, isDirty, isSyncing, isUploading, isOffline, setIsSyncing, setIsUploading, setIsOffline, shouldSuppressEmailErrors, refreshSyncState, hasPendingMigrations, clearDatabase, getVaultMetadata, testDatabaseConnection, verifyEncryptionKey, unlockVault, storeEncryptionKey, storeEncryptionKeyDerivationParams, checkStoredVault, setDatabaseAvailable]);

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
