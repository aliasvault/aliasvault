import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { sendMessage } from 'webext-bridge/popup';

import type { EncryptionKeyDerivationParams } from '@/utils/dist/core/models/metadata';
import SqliteClient from '@/utils/SqliteClient';
import { getItemWithFallback } from '@/utils/StorageUtility';
import type { VaultResponse as messageVaultResponse } from '@/utils/types/messaging/VaultResponse';

import { storage } from '#imports';

/**
 * Vault metadata including the server revision.
 */
type VaultMetadata = {
  publicEmailDomains: string[];
  privateEmailDomains: string[];
  hiddenPrivateEmailDomains: string[];
  serverRevision: number;
};

type DbContextType = {
  sqliteClient: SqliteClient | null;
  dbInitialized: boolean;
  dbAvailable: boolean;
  isOffline: boolean;
  /**
   * True if local vault has changes not yet synced to server.
   */
  isDirty: boolean;
  /**
   * True if a background sync is in progress.
   */
  isSyncing: boolean;
  /**
   * Current server revision number.
   */
  serverRevision: number;
  setIsOffline: (offline: boolean) => Promise<void>;
  /**
   * Set the syncing state.
   */
  setIsSyncing: (syncing: boolean) => void;
  /**
   * Load a decrypted vault into memory (SQLite client).
   */
  loadDatabase: (decryptedVaultBase64: string) => Promise<SqliteClient>;
  /**
   * Load the stored (encrypted) vault from background storage into memory.
   * Returns the SqliteClient if vault was loaded successfully, null otherwise.
   */
  loadStoredDatabase: () => Promise<SqliteClient | null>;
  storeEncryptionKey: (derivedKey: string) => Promise<void>;
  storeEncryptionKeyDerivationParams: (params: EncryptionKeyDerivationParams) => Promise<void>;
  clearDatabase: () => void;
  getVaultMetadata: () => Promise<VaultMetadata | null>;
  /**
   * Refresh sync state (isDirty, serverRevision) from storage.
   */
  refreshSyncState: () => Promise<void>;
  hasPendingMigrations: () => Promise<boolean>;
}

const DbContext = createContext<DbContextType | undefined>(undefined);

/**
 * DbProvider to provide the SQLite client to the app that components can use to make database queries.
 */
export const DbProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  /**
   * SQLite client.
   */
  const [sqliteClient, setSqliteClient] = useState<SqliteClient | null>(null);

  /**
   * Database initialization state. If true, the database has been initialized and the dbAvailable state is correct.
   */
  const [dbInitialized, setDbInitialized] = useState(false);

  /**
   * Database availability state. If true, the database is available. If false, the database is not available and needs to be unlocked or retrieved again from the API.
   */
  const [dbAvailable, setDbAvailable] = useState(false);

  /**
   * Offline mode state. If true, the extension is operating offline.
   */
  const [isOffline, setIsOfflineState] = useState(false);

  /**
   * Dirty state - true if local vault has unsynced changes.
   */
  const [isDirty, setIsDirty] = useState(false);

  /**
   * Syncing state - true if a background sync is in progress.
   */
  const [isSyncing, setIsSyncing] = useState(false);

  /**
   * Server revision number.
   */
  const [serverRevision, setServerRevision] = useState(0);

  /**
   * Set the offline mode state and persist it to local storage.
   */
  const setIsOffline = useCallback(async (offline: boolean) => {
    setIsOfflineState(offline);
    await storage.setItem('local:isOfflineMode', offline);
  }, []);

  /**
   * Load initial state from local storage.
   */
  useEffect(() => {
    /**
     * Load the offline mode and sync state from local storage.
     */
    const loadSyncState = async (): Promise<void> => {
      const [offlineMode, dirty, revision] = await Promise.all([
        storage.getItem('local:isOfflineMode') as Promise<boolean | null>,
        storage.getItem('local:isDirty') as Promise<boolean | null>,
        storage.getItem('local:serverRevision') as Promise<number | null>
      ]);
      setIsOfflineState(offlineMode ?? false);
      setIsDirty(dirty ?? false);
      setServerRevision(revision ?? 0);
    };
    loadSyncState();
  }, []);

  /**
   * Load a decrypted vault into memory (SQLite client).
   */
  const loadDatabase = useCallback(async (decryptedVaultBase64: string) => {
    const client = new SqliteClient();
    await client.initializeFromBase64(decryptedVaultBase64);

    setSqliteClient(client);
    setDbInitialized(true);
    setDbAvailable(true);

    return client;
  }, []);

  /**
   * Load the stored (encrypted) vault from background storage into memory.
   * Returns the SqliteClient if vault was loaded successfully, null otherwise.
   */
  const loadStoredDatabase = useCallback(async (): Promise<SqliteClient | null> => {
    try {
      const response = await sendMessage('GET_VAULT', {}, 'background') as messageVaultResponse;
      if (response?.vault) {
        const client = new SqliteClient();
        await client.initializeFromBase64(response.vault);

        setSqliteClient(client);
        setDbInitialized(true);
        setDbAvailable(true);
        return client;
      } else {
        setDbInitialized(true);
        setDbAvailable(false);
        return null;
      }
    } catch (error) {
      console.error('Error retrieving vault from background:', error);
      setDbInitialized(true);
      setDbAvailable(false);
      return null;
    }
  }, []);

  /**
   * Get the vault metadata from local storage (persistent).
   */
  const getVaultMetadata = useCallback(async () : Promise<VaultMetadata | null> => {
    try {
      // Use fallback for keys migrated from session: to local: in v0.26.0
      const publicEmailDomains = await getItemWithFallback<string[]>('local:publicEmailDomains');
      const privateEmailDomains = await getItemWithFallback<string[]>('local:privateEmailDomains');
      const hiddenPrivateEmailDomains = await getItemWithFallback<string[]>('local:hiddenPrivateEmailDomains');
      const revision = await storage.getItem('local:serverRevision') as number | null;

      if (!publicEmailDomains && !privateEmailDomains) {
        return null;
      }

      return {
        publicEmailDomains: publicEmailDomains ?? [],
        privateEmailDomains: privateEmailDomains ?? [],
        hiddenPrivateEmailDomains: hiddenPrivateEmailDomains ?? [],
        serverRevision: revision ?? 0,
      };
    } catch (error) {
      console.error('Error getting vault metadata from local storage:', error);
      return null;
    }
  }, []);

  /**
   * Refresh sync state from storage (called after background updates it).
   */
  const refreshSyncState = useCallback(async (): Promise<void> => {
    const [dirty, revision] = await Promise.all([
      storage.getItem('local:isDirty') as Promise<boolean | null>,
      storage.getItem('local:serverRevision') as Promise<number | null>
    ]);
    setIsDirty(dirty ?? false);
    setServerRevision(revision ?? 0);
  }, []);

  /**
   * Check if there are pending migrations.
   */
  const hasPendingMigrations = useCallback(async () => {
    if (!sqliteClient) {
      return false;
    }
    return await sqliteClient.hasPendingMigrations();
  }, [sqliteClient]);

  /**
   * Check if database is initialized and try to retrieve and init stored vault
   */
  useEffect(() : void => {
    if (!dbInitialized) {
      loadStoredDatabase();
    }
  }, [dbInitialized, loadStoredDatabase]);

  /**
   * Store encryption key in background worker.
   */
  const storeEncryptionKey = useCallback(async (encryptionKey: string) : Promise<void> => {
    await sendMessage('STORE_ENCRYPTION_KEY', encryptionKey, 'background');
  }, []);

  /**
   * Store encryption key derivation params in background worker.
   */
  const storeEncryptionKeyDerivationParams = useCallback(async (params: EncryptionKeyDerivationParams) : Promise<void> => {
    await sendMessage('STORE_ENCRYPTION_KEY_DERIVATION_PARAMS', params, 'background');
  }, []);

  /**
   * Clear database and remove from background worker, called when logging out.
   */
  const clearDatabase = useCallback(() : void => {
    setSqliteClient(null);
    setDbInitialized(false);
    setDbAvailable(false);
    sendMessage('CLEAR_VAULT', {}, 'background');
  }, []);

  const contextValue = useMemo(() => ({
    sqliteClient,
    dbInitialized,
    dbAvailable,
    isOffline,
    isDirty,
    isSyncing,
    serverRevision,
    setIsOffline,
    setIsSyncing,
    loadDatabase,
    loadStoredDatabase,
    storeEncryptionKey,
    storeEncryptionKeyDerivationParams,
    clearDatabase,
    getVaultMetadata,
    refreshSyncState,
    hasPendingMigrations,
  }), [sqliteClient, dbInitialized, dbAvailable, isOffline, isDirty, isSyncing, serverRevision, setIsOffline, loadDatabase, loadStoredDatabase, storeEncryptionKey, storeEncryptionKeyDerivationParams, clearDatabase, getVaultMetadata, refreshSyncState, hasPendingMigrations]);

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
