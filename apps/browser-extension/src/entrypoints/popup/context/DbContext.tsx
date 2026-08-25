import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';

import { StorageKeys } from '@/utils/constants/storageKeys';
import type { EncryptionKeyDerivationParams } from '@/utils/dist/core/models/metadata';
import EncryptionUtility from '@/utils/EncryptionUtility';
import { onMessage, sendMessage } from '@/utils/messaging/ExtensionMessaging';
import SqliteClient from '@/utils/SqliteClient';
import { getStorageItem } from '@/utils/StorageUtility';
import { AppErrorCode, formatErrorWithCode } from '@/utils/types/errors/AppErrorCodes';
import type { VaultResponse as messageVaultResponse } from '@/utils/types/messaging/VaultResponse';
import { hasUnsyncedUserChanges as hasUnsyncedUserChangesInStorage } from '@/utils/VaultDirtyState';
import { vaultRequiresManifestMigration } from '@/utils/VaultManifestMigration';

import { markOwnEncryptionKey, vaultStateEvents } from '@/events/VaultStateEvents';

import { storage } from '#imports';

/**
 * Maximum time to wait for the background service worker to respond to GET_VAULT.
 * If exceeded, the popup falls back to the unlock screen.
 */
const GET_VAULT_TIMEOUT_MS = 3500;

/**
 * Vault metadata: the email domain lists the server published on the last sync.
 */
type VaultMetadata = {
  publicEmailDomains: string[];
  privateEmailDomains: string[];
  hiddenPrivateEmailDomains: string[];
};

type DbContextType = {
  sqliteClient: SqliteClient | null;
  dbInitialized: boolean;
  dbAvailable: boolean;
  isOffline: boolean;
  /**
   * Get offline state synchronously (avoids React state timing issues).
   */
  getIsOffline: () => boolean;
  /**
   * True if the local vault has user-initiated changes not yet synced to the server. Changes from silent
   * scopes (e.g. item usage statistics) sync just the same but are not reported here, so the UI stays quiet
   * about data the user never asked to save.
   */
  hasUnsyncedUserChanges: boolean;
  /**
   * True if a background sync (download) is in progress.
   */
  isSyncing: boolean;
  /**
   * True if an upload to server is in progress.
   */
  isUploading: boolean;
  setIsOffline: (offline: boolean) => Promise<void>;
  /**
   * Set the syncing (download) state.
   */
  setIsSyncing: (syncing: boolean) => void;
  /**
   * Set the uploading state.
   */
  setIsUploading: (uploading: boolean) => void;
  /**
   * Check if email errors should be suppressed.
   * Errors are suppressed when vault has local changes not yet synced,
   * as the server may not know about newly created items/aliases yet.
   */
  shouldSuppressEmailErrors: () => boolean;
  /**
   * Load a decrypted vault into memory (SQLite client).
   */
  loadDatabase: (sqliteBytes: Uint8Array) => Promise<SqliteClient>;
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
   * Refresh sync state (isDirty) from storage.
   */
  refreshSyncState: () => Promise<void>;
  requiresLegacySqliteBlobMigration: () => Promise<boolean>;
  requiresManifestMigration: () => Promise<boolean>;
  /**
   * Last sync error message persisted by the background sync. Surfaced as a popup
   * alert. Null when no error is pending. Updated reactively via storage.watch so
   * background-initiated sync failures show up immediately while popup is open.
   */
  syncError: string | null;
  /**
   * Dismiss the current sync error (clears both React state and persisted storage).
   */
  clearSyncError: () => Promise<void>;
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
   * Uses both ref (for sync reads) and state (for re-renders).
   */
  const [isOffline, setIsOfflineState] = useState(false);
  const isOfflineRef = useRef(false);

  /**
   * Dirty state - true if the local vault has unsynced changes the user expects to get feedback on.
   */
  const [hasUnsyncedUserChanges, setHasUnsyncedUserChanges] = useState(false);

  /**
   * Syncing state - true if a background sync (download) is in progress.
   */
  const [isSyncing, setIsSyncing] = useState(false);

  /**
   * Uploading state - true if an upload to server is in progress.
   */
  const [isUploading, setIsUploading] = useState(false);

  /**
   * Last sync error written by the background sync. Driven by storage so background-only
   * syncs (e.g. follow-up syncs after pending mutations) reach the user.
   */
  const [syncError, setSyncError] = useState<string | null>(null);

  /**
   * Check if email errors should be suppressed.
   * Errors are suppressed when vault has local changes not yet synced,
   * as the server may not know about newly created items/aliases yet.
   */
  const shouldSuppressEmailErrors = useCallback(() => {
    return hasUnsyncedUserChanges || isSyncing;
  }, [hasUnsyncedUserChanges, isSyncing]);

  /**
   * Set the offline mode state and persist it to local storage.
   * Updates both ref (sync) and state (triggers re-render).
   */
  const setIsOffline = useCallback(async (offline: boolean) => {
    isOfflineRef.current = offline;
    setIsOfflineState(offline);
    await storage.setItem(StorageKeys.IS_OFFLINE_MODE, offline);
  }, []);

  /**
   * Load initial state from local storage.
   */
  useEffect(() => {
    /**
     * Load the offline mode and sync state from local storage.
     */
    const loadSyncState = async (): Promise<void> => {
      const [offlineMode, pendingUserChanges, lastError] = await Promise.all([
        storage.getItem(StorageKeys.IS_OFFLINE_MODE) as Promise<boolean | null>,
        hasUnsyncedUserChangesInStorage(),
        storage.getItem(StorageKeys.LAST_SYNC_ERROR) as Promise<string | null>
      ]);
      isOfflineRef.current = offlineMode ?? false;
      setIsOfflineState(offlineMode ?? false);
      setHasUnsyncedUserChanges(pendingUserChanges);
      setSyncError(lastError ?? null);
    };
    loadSyncState();
  }, []);

  /**
   * Subscribe to background-driven sync error updates so a popup alert appears
   * even when the failing sync wasn't triggered by anything in the popup itself.
   */
  useEffect(() => {
    const unwatch = storage.watch<string | null>(StorageKeys.LAST_SYNC_ERROR, (newValue) => {
      setSyncError(newValue ?? null);
    });
    return (): void => {
      unwatch();
    };
  }, []);

  /**
   * Drive the sync/upload indicators from the background sync itself. The background announces what it is doing as
   * soon as its status call tells it, so the popup never has to make a status call of its own to pick an indicator.
   */
  useEffect(() => {
    return onMessage('VAULT_SYNC_PHASE', ({ data }) => {
      setIsSyncing(data.phase === 'pull');
      setIsUploading(data.phase === 'push');
    });
  }, []);

  /**
   * Dismiss the current sync error from both React state and persisted storage.
   */
  const clearSyncError = useCallback(async (): Promise<void> => {
    setSyncError(null);
    await storage.removeItem(StorageKeys.LAST_SYNC_ERROR);
  }, []);

  // Reflect locks from other windows.
  useEffect(() => {
    return vaultStateEvents.onVaultLocked(() => {
      EncryptionUtility.clearRsaPrivateKeyCache();
      setSqliteClient(null);
      setDbAvailable(false);
    });
  }, []);

  /**
   * Load a decrypted vault into memory (SQLite client).
   */
  const loadDatabase = useCallback(async (sqliteBytes: Uint8Array) => {
    const client = new SqliteClient();
    await client.initializeFromBytes(sqliteBytes);

    setSqliteClient(client);
    setDbInitialized(true);
    setDbAvailable(true);

    return client;
  }, []);

  /**
   * Load the stored (encrypted) vault from background storage into memory.
   * Returns the SqliteClient if vault was loaded successfully.
   * Throws an error if the background returns an error (all errors now have E-XXX codes).
   */
  const loadStoredDatabase = useCallback(async (): Promise<SqliteClient | null> => {
    try {
      // Use timeout to prevent the popup from spinning indefinitely.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(formatErrorWithCode('Background service worker timed out', AppErrorCode.UNKNOWN_ERROR)));
        }, GET_VAULT_TIMEOUT_MS);
      });

      let response: messageVaultResponse;
      try {
        response = await Promise.race([
          sendMessage('GET_VAULT'),
          timeoutPromise,
        ]);
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }

      // Check if response contains an error - throw it so callers can handle
      if (!response?.success && response?.error) {
        throw new Error(response.error);
      }

      if (response?.vault) {
        const client = new SqliteClient();
        await client.initializeFromBase64(response.vault);

        setSqliteClient(client);
        setDbInitialized(true);
        setDbAvailable(true);
        return client;
      } else {
        // No vault and no error - this shouldn't happen but handle gracefully
        setDbInitialized(true);
        setDbAvailable(false);
        return null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(AppErrorCode.VAULT_LOCKED)) {
        // Vault is locked which is expected when the popup is opened after auto-lock timeout or browser restart.
        console.info('Vault is locked; popup will prompt for unlock');
      } else {
        console.error('Error retrieving vault from background:', error);
      }
      setDbInitialized(true);
      setDbAvailable(false);
      // Re-throw all errors so callers can display them with proper codes
      throw error;
    }
  }, []);

  /**
   * Get the vault metadata from local storage (persistent).
   */
  const getVaultMetadata = useCallback(async () : Promise<VaultMetadata | null> => {
    try {
      // Use fallback for keys migrated from session: to local: in v0.26.0
      const publicEmailDomains = await getStorageItem<string[]>(StorageKeys.PUBLIC_EMAIL_DOMAINS);
      const privateEmailDomains = await getStorageItem<string[]>(StorageKeys.PRIVATE_EMAIL_DOMAINS);
      const hiddenPrivateEmailDomains = await getStorageItem<string[]>(StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS);

      if (!publicEmailDomains && !privateEmailDomains) {
        return null;
      }

      return {
        publicEmailDomains: publicEmailDomains ?? [],
        privateEmailDomains: privateEmailDomains ?? [],
        hiddenPrivateEmailDomains: hiddenPrivateEmailDomains ?? [],
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
    setHasUnsyncedUserChanges(await hasUnsyncedUserChangesInStorage());
  }, []);

  /**
   * Check if there are pending migrations.
   */
  const requiresLegacySqliteBlobMigration = useCallback(async () => {
    if (!sqliteClient) {
      return false;
    }
    return await sqliteClient.requiresLegacySqliteBlobMigration();
  }, [sqliteClient]);

  /**
   * Check if the vault still has to be migrated to the current storage model.
   */
  const requiresManifestMigration = useCallback(async () => {
    if (!sqliteClient) {
      return false;
    }
    return await vaultRequiresManifestMigration(sqliteClient);
  }, [sqliteClient]);

  /**
   * Check if database is initialized and try to retrieve and init stored vault
   */
  useEffect(() : void => {
    if (!dbInitialized) {
      // Any errors are handled separately via dbAvailable/syncError state.
      loadStoredDatabase().catch(() => { });
    }
  }, [dbInitialized, loadStoredDatabase]);

  /**
   * Store encryption key in background worker.
   */
  const storeEncryptionKey = useCallback(async (encryptionKey: string) : Promise<void> => {
    /*
     * Mark as our own write BEFORE sending, so the cross-window watcher
     * ignores the storage event triggered by this same flow.
     */
    markOwnEncryptionKey(encryptionKey);
    await sendMessage('STORE_ENCRYPTION_KEY', encryptionKey);
  }, []);

  /**
   * Store encryption key derivation params in background worker.
   */
  const storeEncryptionKeyDerivationParams = useCallback(async (params: EncryptionKeyDerivationParams) : Promise<void> => {
    await sendMessage('STORE_ENCRYPTION_KEY_DERIVATION_PARAMS', params);
  }, []);

  /**
   * Clear database and remove from background worker, called when logging out.
   */
  const clearDatabase = useCallback(() : void => {
    EncryptionUtility.clearRsaPrivateKeyCache();
    setSqliteClient(null);
    setDbInitialized(false);
    setDbAvailable(false);
  }, []);

  /**
   * Get offline state synchronously from ref.
   */
  const getIsOffline = useCallback(() => isOfflineRef.current, []);

  const contextValue = useMemo(() => ({
    sqliteClient,
    dbInitialized,
    dbAvailable,
    isOffline,
    getIsOffline,
    hasUnsyncedUserChanges,
    isSyncing,
    isUploading,
    setIsOffline,
    setIsSyncing,
    setIsUploading,
    shouldSuppressEmailErrors,
    loadDatabase,
    loadStoredDatabase,
    storeEncryptionKey,
    storeEncryptionKeyDerivationParams,
    clearDatabase,
    getVaultMetadata,
    refreshSyncState,
    requiresLegacySqliteBlobMigration,
    requiresManifestMigration,
    syncError,
    clearSyncError,
  }), [sqliteClient, dbInitialized, dbAvailable, isOffline, getIsOffline, hasUnsyncedUserChanges, isSyncing, isUploading, setIsOffline, shouldSuppressEmailErrors, loadDatabase, loadStoredDatabase, storeEncryptionKey, storeEncryptionKeyDerivationParams, clearDatabase, getVaultMetadata, refreshSyncState, requiresLegacySqliteBlobMigration, requiresManifestMigration, syncError, clearSyncError]);

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
