import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

import type { EncryptionKeyDerivationParams, VaultMetadata } from '@/utils/dist/shared/models/metadata';
import type { VaultResponse } from '@/utils/dist/shared/models/webapi';
import SqliteClient from '@/utils/SqliteClient';

import NativeVaultManager from '@/specs/NativeVaultManager';

type DbContextType = {
  sqliteClient: SqliteClient | null;
  dbInitialized: boolean;
  dbAvailable: boolean;
  storeEncryptionKey: (derivedKey: string) => Promise<void>;
  storeEncryptionKeyDerivationParams: (keyDerivationParams: EncryptionKeyDerivationParams) => Promise<void>;
  initializeDatabase: (vaultResponse: VaultResponse) => Promise<void>;
  hasPendingMigrations: () => Promise<boolean>;
  clearDatabase: () => void;
  getVaultMetadata: () => Promise<VaultMetadata | null>;
  testDatabaseConnection: (derivedKey: string) => Promise<boolean>;
  unlockVault: () => Promise<boolean>;
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
   * Unlock the vault in the native module which will decrypt the database using the stored encryption key
   * and load it into memory.
   */
  const unlockVault = useCallback(async () : Promise<boolean> => {
    try {
      await NativeVaultManager.unlockVault();
      return true;
    } catch (error: any) {
      console.error('Failed to unlock vault:', error);
      if (error?.code === 'DATABASE_SETUP_ERROR') {
        console.error('Database setup error:', error.message);
      }
      return false;
    }
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
   * Initialize the database in the native module.
   *
   * @param vaultResponse The vault response from the API
   */
  const initializeDatabase = useCallback(async (vaultResponse: VaultResponse) => {
    const metadata: VaultMetadata = {
      publicEmailDomains: vaultResponse.vault.publicEmailDomainList,
      privateEmailDomains: vaultResponse.vault.privateEmailDomainList,
      vaultRevisionNumber: vaultResponse.vault.currentRevisionNumber,
    };

    // Store the encrypted database and metadata (metadata is stored in plain text in UserDefaults)
    await sqliteClient.storeEncryptedDatabase(vaultResponse.vault.blob);
    await sqliteClient.storeMetadata(JSON.stringify(metadata));

    // Initialize the database in the native module
    await unlockVault();

    setDbInitialized(true);
    setDbAvailable(true);
  }, [sqliteClient, unlockVault]);

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
   * Get the current vault metadata directly from SQLite client
   */
  const getVaultMetadata = useCallback(async () : Promise<VaultMetadata | null> => {
    return await sqliteClient.getVaultMetadata();
  }, [sqliteClient]);

  /**
   * Test if the database is working with the provided (to be stored) encryption key by performing a simple query
   * @param derivedKey The encryption key to test with
   * @returns true if the database is working, false otherwise
   */
  const testDatabaseConnection = useCallback(async (derivedKey: string): Promise<boolean> => {
    // Store the encryption key
    await sqliteClient.storeEncryptionKey(derivedKey);

    // Initialize the database
    const unlocked = await unlockVault();
    if (!unlocked) {
      return false;
    }

    // Try to get the database version as a simple test query
    const version = await sqliteClient.getDatabaseVersion();
    if (version && version.version && version.version.length > 0) {
      return true;
    }

    return false;
  }, [sqliteClient, unlockVault]);

  const contextValue = useMemo(() => ({
    sqliteClient,
    dbInitialized,
    dbAvailable,
    initializeDatabase,
    hasPendingMigrations,
    clearDatabase,
    getVaultMetadata,
    testDatabaseConnection,
    unlockVault,
    storeEncryptionKey,
    storeEncryptionKeyDerivationParams,
  }), [sqliteClient, dbInitialized, dbAvailable, initializeDatabase, hasPendingMigrations, clearDatabase, getVaultMetadata, testDatabaseConnection, unlockVault, storeEncryptionKey, storeEncryptionKeyDerivationParams]);

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
