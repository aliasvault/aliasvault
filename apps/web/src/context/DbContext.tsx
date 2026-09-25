import { AppErrorCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import EncryptionUtility from '@aliasvault/client/crypto/EncryptionUtility';
import SqliteClient from '@aliasvault/client/database/SqliteClient';
import { getPlatform } from '@aliasvault/client/platform';
import { syncErrorMessage, toSyncErrorDetail } from '@aliasvault/client/sync/SyncErrorMessage';
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { StorageKeys } from '@/utils/StorageKeys';
import { vaultStore } from '@/vault/VaultStore';

import type { SyncErrorDetail } from '@aliasvault/client/sync/VaultSync';

type DbContextType = {
  sqliteClient: SqliteClient | null;
  dbInitialized: boolean;
  dbAvailable: boolean;
  isOffline: boolean;
  getIsOffline: () => boolean;
  setIsOffline: (offline: boolean) => Promise<void>;
  isSyncing: boolean;
  isUploading: boolean;
  loadStoredDatabase: () => Promise<SqliteClient | null>;
  clearDatabase: () => void;
  /** Last background sync error, translated in the current display language. Null when no error is pending. */
  syncError: string | null;
  /** Dismiss the current sync error. */
  clearSyncError: () => Promise<void>;
}

const DbContext = createContext<DbContextType | undefined>(undefined);

/**
 * DbProvider: the decrypted vault and the sync state the UI shows.
 */
export const DbProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [sqliteClient, setSqliteClient] = useState<SqliteClient | null>(null);
  const [dbInitialized, setDbInitialized] = useState(false);
  const [dbAvailable, setDbAvailable] = useState(false);
  const [isOffline, setIsOfflineState] = useState(false);
  const isOfflineRef = useRef(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [syncErrorDetail, setSyncErrorDetail] = useState<SyncErrorDetail | null>(null);

  const syncError = useMemo(() => syncErrorDetail ? syncErrorMessage(syncErrorDetail, t) ?? null : null, [syncErrorDetail, t]);

  /**
   * Set the offline mode state and persist it.
   */
  const setIsOffline = useCallback(async (offline: boolean) => {
    isOfflineRef.current = offline;
    setIsOfflineState(offline);
    await getPlatform().storage.set(StorageKeys.IS_OFFLINE_MODE, offline);
  }, []);

  /**
   * Load the offline mode and the last sync error from storage.
   */
  useEffect(() => {
    /**
     * Load the persisted state.
     */
    const loadSyncState = async (): Promise<void> => {
      const storage = getPlatform().storage;
      const [offlineMode, lastError] = await Promise.all([storage.get<boolean>(StorageKeys.IS_OFFLINE_MODE), storage.get(StorageKeys.LAST_SYNC_ERROR)]);
      isOfflineRef.current = offlineMode ?? false;
      setIsOfflineState(offlineMode ?? false);
      setSyncErrorDetail(toSyncErrorDetail(lastError));
    };
    void loadSyncState();
  }, []);

  /**
   * Reflect the sync error every sync persists (see VaultStore.fullVaultSync), whoever started it.
   */
  useEffect(() => {
    return getPlatform().storage.watch(StorageKeys.LAST_SYNC_ERROR, (newValue) => {
      setSyncErrorDetail(toSyncErrorDetail(newValue));
    });
  }, []);

  /**
   * Drive the sync/upload indicators from the sync itself.
   */
  useEffect(() => {
    return vaultStore.onSyncPhase((phase) => {
      setIsSyncing(phase === 'pull');
      setIsUploading(phase === 'push');
    });
  }, []);

  /**
   * Dismiss the current sync error.
   */
  const clearSyncError = useCallback(async (): Promise<void> => {
    setSyncErrorDetail(null);
    await getPlatform().storage.remove(StorageKeys.LAST_SYNC_ERROR);
  }, []);

  /**
   * Load the stored (encrypted) vault into memory.
   * @throws When the vault cannot be opened (all errors carry an E-XXX code).
   */
  const loadStoredDatabase = useCallback(async (): Promise<SqliteClient | null> => {
    try {
      const response = await vaultStore.getVault();
      if (!response.success && response.error) {
        throw new Error(response.error);
      }

      if (response.vault) {
        const client = new SqliteClient();
        await client.initializeFromBytes(response.vault);
        setSqliteClient(client);
        setDbInitialized(true);
        setDbAvailable(true);
        return client;
      }

      setDbInitialized(true);
      setDbAvailable(false);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes(AppErrorCode.VAULT_LOCKED) && !message.includes(AppErrorCode.VAULT_NOT_FOUND)) {
        console.error('Error opening the stored vault:', error);
      }
      setDbInitialized(true);
      setDbAvailable(false);
      throw error;
    }
  }, []);

  /**
   * Try to open the stored vault once on mount.
   */
  useEffect((): void => {
    if (!dbInitialized) {
      loadStoredDatabase().catch(() => { });
    }
  }, [dbInitialized, loadStoredDatabase]);

  /**
   * Drop the in-memory database, called when logging out or locking.
   */
  const clearDatabase = useCallback((): void => {
    EncryptionUtility.clearRsaPrivateKeyCache();
    setSqliteClient(null);
    setDbInitialized(false);
    setDbAvailable(false);
  }, []);

  /**
   * Get offline state.
   */
  const getIsOffline = useCallback(() => isOfflineRef.current, []);

  const contextValue = useMemo(() => ({
    sqliteClient,
    dbInitialized,
    dbAvailable,
    isOffline,
    getIsOffline,
    setIsOffline,
    isSyncing,
    isUploading,
    loadStoredDatabase,
    clearDatabase,
    syncError,
    clearSyncError,
  }), [sqliteClient, dbInitialized, dbAvailable, isOffline, getIsOffline, setIsOffline, isSyncing, isUploading, loadStoredDatabase, clearDatabase, syncError, clearSyncError]);

  return (
    <DbContext.Provider value={contextValue}>
      {children}
    </DbContext.Provider>
  );
};

/**
 * Hook to use the DbContext.
 */
export const useDb = (): DbContextType => {
  const context = useContext(DbContext);
  if (context === undefined) {
    throw new Error('useDb must be used within a DbProvider');
  }
  return context;
};
