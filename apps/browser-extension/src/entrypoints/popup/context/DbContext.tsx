import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';

import type { EncryptionKeyDerivationParams } from '@/utils/dist/core/models/metadata';
import EncryptionUtility from '@/utils/EncryptionUtility';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';
import SqliteClient from '@/utils/SqliteClient';
import { getItemWithFallback } from '@/utils/StorageUtility';
import { AppErrorCode, formatErrorWithCode } from '@/utils/types/errors/AppErrorCodes';

import { markOwnEncryptionKey, vaultStateEvents } from '@/events/VaultStateEvents';
import { t } from '@/i18n/StandaloneI18n';

import { storage } from '#imports';

/**
 * Maximum time to wait for the background service worker to answer a PING before treating it as unresponsive.
 */
const BACKGROUND_PING_TIMEOUT_MS = 5000;

/**
 * Maximum time to wait for GET_VAULT once the background is responsive (large vaults take a while to decrypt and transfer).
 */
const GET_VAULT_TIMEOUT_MS = 30000;

/**
 * Wrap a promise in a timeout that returns a rejected promise with a translated error carrying the given code.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: AppErrorCode, translationKey: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      void t(translationKey).then(message => reject(new Error(formatErrorWithCode(message, code))));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

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
   * Get offline state synchronously (avoids React state timing issues).
   */
  getIsOffline: () => boolean;
  /**
   * True if local vault has changes not yet synced to server.
   */
  isDirty: boolean;
  /**
   * True if a background sync (download) is in progress.
   */
  isSyncing: boolean;
  /**
   * True if an upload to server is in progress.
   */
  isUploading: boolean;
  /**
   * Current server revision number.
   */
  serverRevision: number;
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
   * Dirty state - true if local vault has unsynced changes.
   */
  const [isDirty, setIsDirty] = useState(false);

  /**
   * Syncing state - true if a background sync (download) is in progress.
   */
  const [isSyncing, setIsSyncing] = useState(false);

  /**
   * Uploading state - true if an upload to server is in progress.
   */
  const [isUploading, setIsUploading] = useState(false);

  /**
   * Server revision number.
   */
  const [serverRevision, setServerRevision] = useState(0);

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
    return isDirty || isSyncing;
  }, [isDirty, isSyncing]);

  /**
   * Set the offline mode state and persist it to local storage.
   * Updates both ref (sync) and state (triggers re-render).
   */
  const setIsOffline = useCallback(async (offline: boolean) => {
    isOfflineRef.current = offline;
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
      const [offlineMode, dirty, revision, lastError] = await Promise.all([
        storage.getItem('local:isOfflineMode') as Promise<boolean | null>,
        storage.getItem('local:isDirty') as Promise<boolean | null>,
        storage.getItem('local:serverRevision') as Promise<number | null>,
        storage.getItem('local:lastSyncError') as Promise<string | null>
      ]);
      isOfflineRef.current = offlineMode ?? false;
      setIsOfflineState(offlineMode ?? false);
      setIsDirty(dirty ?? false);
      setServerRevision(revision ?? 0);
      setSyncError(lastError ?? null);
    };
    loadSyncState();
  }, []);

  /**
   * Subscribe to background-driven sync error updates so a popup alert appears
   * even when the failing sync wasn't triggered by anything in the popup itself.
   */
  useEffect(() => {
    const unwatch = storage.watch<string | null>('local:lastSyncError', (newValue) => {
      setSyncError(newValue ?? null);
    });
    return (): void => {
      unwatch();
    };
  }, []);

  /**
   * Dismiss the current sync error from both React state and persisted storage.
   */
  const clearSyncError = useCallback(async (): Promise<void> => {
    setSyncError(null);
    await storage.removeItem('local:lastSyncError');
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
   * Returns the SqliteClient if vault was loaded successfully.
   * Throws an error if the background returns an error (all errors now have E-XXX codes).
   */
  const loadStoredDatabase = useCallback(async (): Promise<SqliteClient | null> => {
    try {
      // Ping service worker with a short timeout so an unresponsive service worker fails fast instead of keeping the popup open indefinitely.
      await withTimeout(sendMessage('PING'), BACKGROUND_PING_TIMEOUT_MS, AppErrorCode.BACKGROUND_UNRESPONSIVE, 'common.errors.backgroundUnresponsive');

      // Get vault from background with a 30sec timeout as decrypting and transferring a large vault can take several seconds depending on the device hardware.
      const response = await withTimeout(sendMessage('GET_VAULT'), GET_VAULT_TIMEOUT_MS, AppErrorCode.VAULT_LOAD_TIMEOUT, 'common.errors.vaultLoadTimeout');

      // Check if response contains an error, if so, throw.
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
    isDirty,
    isSyncing,
    isUploading,
    serverRevision,
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
    hasPendingMigrations,
    syncError,
    clearSyncError,
  }), [sqliteClient, dbInitialized, dbAvailable, isOffline, getIsOffline, isDirty, isSyncing, isUploading, serverRevision, setIsOffline, shouldSuppressEmailErrors, loadDatabase, loadStoredDatabase, storeEncryptionKey, storeEncryptionKeyDerivationParams, clearDatabase, getVaultMetadata, refreshSyncState, hasPendingMigrations, syncError, clearSyncError]);

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
