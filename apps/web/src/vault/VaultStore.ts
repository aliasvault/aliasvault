/**
 * The web app's vault store: the at-rest (encrypted) vault, the session key, and the interface with the Rust sync engine.
 */

import { AppErrorCode, formatErrorWithCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { VaultKeyService } from '@aliasvault/client/auth/VaultKeyService';
import { decryptVaultBlob } from '@aliasvault/client/crypto/VaultBlob';
import { SqliteClient } from '@aliasvault/client/database/SqliteClient';
import { getPlatform } from '@aliasvault/client/platform';
import { clearDirtyScopes, getDirtyScopes } from '@aliasvault/client/sync/VaultDirtyState';
import { vaultRequiresManifestMigration, VaultMigrationKind } from '@aliasvault/client/sync/VaultManifestMigration';
import { DEFAULT_VAULT_MUTATION_SCOPE, hasUserVisibleScope, type VaultMutationScope } from '@aliasvault/client/sync/VaultMutationScope';
import { hasSyncError, syncResult, VaultSync, type FullVaultSyncResult, type VaultManifestMigrationResult } from '@aliasvault/client/sync/VaultSync';
import { type IVaultSyncEngineHost, type VaultSyncOptions, type VaultSyncPhase as EngineSyncPhase, type VaultSyncStoreOutcome, type VaultSyncStoreRequest } from '@aliasvault/client/sync/VaultSyncEngine';
import { getVaultSyncHoldReason } from '@aliasvault/client/sync/VaultSyncHold';

import i18n from '@/i18n/i18n';
import { devLog } from '@/utils/DevLogger';
import { AUTH_STORAGE_KEYS, dirtyScopeStorageKey, SESSION_STORAGE_KEYS, StorageKeys, vaultDataStorageKeys, VAULT_LOCK_STORAGE_KEYS } from '@/utils/StorageKeys';

import type { ISqliteDatabase, SqliteValue } from '@aliasvault/client/platform';
import type { UnlockKeyDerivationParams } from '@aliasvault/models/metadata';

/** What a running sync is doing, or idle. */
export type VaultSyncPhase = 'pull' | 'push' | 'idle';

/** The decrypted vault, or why it could not be opened. */
export type VaultResponse = {
  success: boolean;
  error?: string;
  vault?: Uint8Array;
};

/** The email domain lists the server published on the last sync. */
export type VaultMetadata = {
  publicEmailDomains: string[];
  privateEmailDomains: string[];
  hiddenPrivateEmailDomains: string[];
};

/** What a full sync may be asked beyond what the revisions decide. */
export type FullVaultSyncRequest = VaultSyncOptions & {
  /** Persist a failure so the UI shows it (default true). A login-time pull reports its own errors. */
  reportErrorToPopup?: boolean;
};

let cachedSqliteClient: SqliteClient | null = null;
let cachedVaultBlob: string | null = null;
let isSyncInProgress = false;
let hasPendingSync = false;

const phaseListeners = new Set<(phase: VaultSyncPhase) => void>();

/**
 * Tell the UI what the sync is doing.
 * @param phase - the phase
 */
function broadcastSyncPhase(phase: VaultSyncPhase): void {
  phaseListeners.forEach(listener => listener(phase));
}

/**
 * Drop the cached decrypted vault.
 */
function cleanupCachedSqliteClient(): void {
  cachedSqliteClient?.close();
  cachedSqliteClient = null;
  cachedVaultBlob = null;
}

/**
 * The session vault key, derived from the session unlock key and the cached key chain, or null while locked.
 */
async function getEncryptionKey(): Promise<string | null> {
  return VaultKeyService.getSessionVaultEncryptionKey();
}

/**
 * The stored encrypted vault blob.
 */
async function getEncryptedVault(): Promise<string | null> {
  return getPlatform().storage.get<string>(StorageKeys.ENCRYPTED_VAULT);
}

/**
 * Open the stored vault for the sync engine.
 * @throws When the vault is missing or locked.
 */
async function createVaultSqliteClient(): Promise<SqliteClient> {
  const encryptedVault = await getEncryptedVault();
  const encryptionKey = await getEncryptionKey();
  if (!encryptedVault) {
    throw new Error(formatErrorWithCode(i18n.t('common.errors.vaultNotAvailable'), AppErrorCode.VAULT_NOT_FOUND));
  }
  if (!encryptionKey) {
    throw new Error(formatErrorWithCode(i18n.t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  if (cachedSqliteClient && cachedVaultBlob === encryptedVault) {
    return cachedSqliteClient;
  }

  const decryptedVault = await decryptVaultBlob(encryptedVault, encryptionKey);
  const sqliteClient = new SqliteClient();
  await sqliteClient.initializeFromBytes(decryptedVault);

  cachedSqliteClient = sqliteClient;
  cachedVaultBlob = encryptedVault;
  return sqliteClient;
}

/**
 * Store the encrypted vault blob.
 *
 * Two modes: a local mutation (markDirty) always succeeds and bumps the mutation sequence; a sync store
 * (expectedMutationSeq) only succeeds when no mutation happened since the sync started, so a sync never
 * overwrites concurrent local changes.
 * @param request - the blob and how to record it
 */
async function storeEncryptedVault(request: { vaultBlob: string; markDirty?: boolean; expectedMutationSeq?: number; scopes?: VaultMutationScope[] }): Promise<{ success: boolean; mutationSequence: number }> {
  const storage = getPlatform().storage;
  let mutationSequence = await storage.get<number>(StorageKeys.MUTATION_SEQUENCE) ?? 0;

  if (request.expectedMutationSeq !== undefined && request.expectedMutationSeq !== mutationSequence) {
    return { success: false, mutationSequence };
  }

  if (request.markDirty) {
    mutationSequence++;
    // A store that names no scope changed something the repositories do not account for, so it pushes the full manifest.
    const dirtyScopes = request.scopes?.length ? request.scopes : [DEFAULT_VAULT_MUTATION_SCOPE];
    await storage.setMany([
      { key: StorageKeys.ENCRYPTED_VAULT, value: request.vaultBlob },
      { key: StorageKeys.MUTATION_SEQUENCE, value: mutationSequence },
      { key: StorageKeys.IS_DIRTY, value: true },
      ...dirtyScopes.map(scope => ({ key: dirtyScopeStorageKey(scope), value: true })),
    ]);
  } else {
    await storage.set(StorageKeys.ENCRYPTED_VAULT, request.vaultBlob);
  }

  // The blob changed, so the cached client no longer matches it.
  cachedSqliteClient = null;
  cachedVaultBlob = null;

  return { success: true, mutationSequence };
}

/**
 * Clear the dirty flag unless a mutation raced the sync.
 * @param mutationSeqAtStart - the mutation sequence when the sync started
 */
async function markVaultClean(mutationSeqAtStart: number): Promise<boolean> {
  const storage = getPlatform().storage;
  const currentMutationSeq = await storage.get<number>(StorageKeys.MUTATION_SEQUENCE) ?? 0;
  if (currentMutationSeq === mutationSeqAtStart) {
    await storage.set(StorageKeys.IS_DIRTY, false);
    await clearDirtyScopes();
    return true;
  }
  return false;
}

/**
 * The Rust sync engine's host: how it reaches the local vault and the at-rest blob.
 */
const syncEngineHost: IVaultSyncEngineHost = {
  /**
   * The open vault. A store clears the cache, so the next call re-opens the blob just stored.
   */
  localDatabase: async (): Promise<ISqliteDatabase> => {
    const sqliteClient = await createVaultSqliteClient();
    const db = sqliteClient.getDb();
    if (!db) {
      throw new Error('Vault database not initialized');
    }
    return {
      /** Run a statement. */
      run: (sql: string, params?: SqliteValue[]): number => db.run(sql, params),
      /** Run a query. */
      query: <T,>(sql: string, params?: SqliteValue[]): T[] => db.query<T>(sql, params),
      /** Run raw SQL. */
      exec: (sql: string): void => db.exec(sql),
      /** Export through the client so it can compact the file first. */
      export: (): Uint8Array => sqliteClient.exportToBytes(),
      /** The cached client owns the database's lifetime. */
      close: (): void => {},
    };
  },
  /**
   * The stored vault blob.
   */
  loadVault: (): Promise<string | null> => getEncryptedVault(),
  /**
   * Persist a vault blob the engine produced.
   */
  storeVault: (request: VaultSyncStoreRequest): Promise<VaultSyncStoreOutcome> =>
    storeEncryptedVault({ vaultBlob: request.encryptedBlob, markDirty: request.markDirty, expectedMutationSeq: request.expectedMutationSeq }),
  /**
   * Clear the dirty flag unless a mutation raced the sync.
   */
  markClean: (mutationSeqAtStart: number): Promise<boolean> => markVaultClean(mutationSeqAtStart),
  /**
   * Drop an in-memory vault holding changes no store persisted; the next reader reopens the stored blob.
   */
  discardLocalDatabase: (): void => {
    cachedSqliteClient = null;
    cachedVaultBlob = null;
  },
  /**
   * Show the UI what the sync is doing.
   */
  onPhase: (phase: EngineSyncPhase): void => {
    if (phase === 'pull') {
      broadcastSyncPhase('pull');
      return;
    }
    void getDirtyScopes().then(scopes => {
      if (hasUserVisibleScope(scopes)) {
        broadcastSyncPhase('push');
      }
    });
  },
};

/**
 * The sync operations on the stored vault.
 */
const vaultSync = new VaultSync(syncEngineHost, createVaultSqliteClient);

/**
 * Persist a sync failure so the UI can surface it; any other outcome clears the stored failure.
 * @param result - the sync outcome
 */
async function persistSyncErrorState(result: FullVaultSyncResult): Promise<void> {
  const storage = getPlatform().storage;
  const dedicatedError = result.requiresLogout || result.wasOffline;
  if (hasSyncError(result) && !dedicatedError) {
    await storage.set(StorageKeys.LAST_SYNC_ERROR, { errorKey: result.errorKey, errorCode: result.errorCode, error: result.error });
  } else {
    await storage.remove(StorageKeys.LAST_SYNC_ERROR);
  }
}

/**
 * Whether a sync has to yield to a sync hold (see VaultSyncHold).
 */
async function syncIsOnHold(): Promise<boolean> {
  const reason = await getVaultSyncHoldReason();
  if (reason) {
    devLog(`[VaultSync] Sync refused: on hold for ${reason}.`);
  }
  return reason !== null;
}

/**
 * Full vault sync (push and pull based on revision counters), one at a time.
 * @param options - what the caller asks beyond what the revisions decide
 */
async function fullVaultSyncInternal(options?: VaultSyncOptions): Promise<FullVaultSyncResult> {
  if (await syncIsOnHold()) {
    return syncResult({ success: false });
  }

  if (isSyncInProgress) {
    hasPendingSync = true;
    devLog('[VaultSync] Sync already in progress, queued for retry after completion');
    return syncResult();
  }

  isSyncInProgress = true;
  hasPendingSync = false;

  try {
    return await vaultSync.syncVaultWithServer(options);
  } finally {
    isSyncInProgress = false;
    broadcastSyncPhase('idle');

    if (hasPendingSync) {
      devLog('[VaultSync] Pending mutations detected, triggering follow-up sync');
      hasPendingSync = false;
      vaultStore.fullVaultSync().catch(err => {
        console.error('[VaultSync] Follow-up sync failed:', err);
      });
    }
  }
}

/**
 * The vault store.
 */
export const vaultStore = {
  /**
   * Subscribe to sync phase changes.
   * @param listener - called with the phase
   */
  onSyncPhase(listener: (phase: VaultSyncPhase) => void): () => void {
    phaseListeners.add(listener);
    return (): void => {
      phaseListeners.delete(listener);
    };
  },

  getEncryptionKey,
  getEncryptedVault,
  storeEncryptedVault,
  createVaultSqliteClient,

  /**
   * Store the session unlock key.
   * @param unlockKey - the unlock key
   */
  async storeUnlockKey(unlockKey: string): Promise<void> {
    await getPlatform().storage.set(StorageKeys.UNLOCK_KEY, unlockKey);
  },

  /**
   * Store the unlock key derivation parameters, which enable an offline unlock.
   * @param params - the parameters
   */
  async storeUnlockKeyDerivationParams(params: UnlockKeyDerivationParams): Promise<void> {
    await getPlatform().storage.set(StorageKeys.UNLOCK_KEY_DERIVATION_PARAMS, params);
  },

  /**
   * Decrypt the stored vault.
   */
  async getVault(): Promise<VaultResponse> {
    try {
      const [encryptionKey, encryptedVault] = await Promise.all([getEncryptionKey(), getEncryptedVault()]);
      if (!encryptedVault) {
        return { success: false, error: formatErrorWithCode(i18n.t('common.errors.vaultNotAvailable'), AppErrorCode.VAULT_NOT_FOUND) };
      }
      if (!encryptionKey) {
        return { success: false, error: formatErrorWithCode(i18n.t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED) };
      }
      return { success: true, vault: await decryptVaultBlob(encryptedVault, encryptionKey) };
    } catch (error) {
      console.error('Failed to get vault:', error);
      return { success: false, error: formatErrorWithCode(i18n.t('common.errors.unknownError'), AppErrorCode.VAULT_DECRYPT_FAILED) };
    }
  },

  /**
   * The email domain lists from the last sync, or null when no sync recorded them yet.
   */
  async getVaultMetadata(): Promise<VaultMetadata | null> {
    try {
      const storage = getPlatform().storage;
      const [publicEmailDomains, privateEmailDomains, hiddenPrivateEmailDomains] = await Promise.all([
        storage.get<string[]>(StorageKeys.PUBLIC_EMAIL_DOMAINS),
        storage.get<string[]>(StorageKeys.PRIVATE_EMAIL_DOMAINS),
        storage.get<string[]>(StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS),
      ]);
      if (!publicEmailDomains && !privateEmailDomains) {
        return null;
      }
      return { publicEmailDomains: publicEmailDomains ?? [], privateEmailDomains: privateEmailDomains ?? [], hiddenPrivateEmailDomains: hiddenPrivateEmailDomains ?? [] };
    } catch (error) {
      console.error('Error getting vault metadata from storage:', error);
      return null;
    }
  },

  /**
   * Whether the user is logged in and whether the vault can be opened right now.
   */
  async checkAuthStatus(): Promise<{ isLoggedIn: boolean; isVaultLocked: boolean; hasStoredVault: boolean }> {
    const storage = getPlatform().storage;
    const [username, accessToken, vaultData, unlockKey] = await Promise.all([storage.get<string>(StorageKeys.USERNAME), storage.get<string>(StorageKeys.ACCESS_TOKEN), getEncryptedVault(), VaultKeyService.getSessionUnlockKey()]);
    const isLoggedIn = username !== null && accessToken !== null;
    return { isLoggedIn, isVaultLocked: isLoggedIn && unlockKey === null, hasStoredVault: vaultData !== null };
  },

  /**
   * Lock the vault: clear the session keys, keep the encrypted vault so the user can unlock without the server.
   */
  async lockVault(): Promise<void> {
    await getPlatform().storage.removeMany([...VAULT_LOCK_STORAGE_KEYS]);
    cleanupCachedSqliteClient();
  },

  /**
   * Clear the session: tokens, session keys and the vault itself (forced logout, keeps the username for prefill).
   */
  async clearSession(): Promise<void> {
    const storage = getPlatform().storage;
    await storage.removeMany([...AUTH_STORAGE_KEYS]);
    await storage.removeMany([...SESSION_STORAGE_KEYS]);
    await storage.removeMany(vaultDataStorageKeys());
    cleanupCachedSqliteClient();
  },

  /**
   * Clear the vault data and the username (user-initiated logout).
   */
  async clearVaultData(): Promise<void> {
    await getPlatform().storage.removeMany([...vaultDataStorageKeys(), StorageKeys.USERNAME]);
    cleanupCachedSqliteClient();
  },

  /**
   * Full vault sync, persisting a failure for the UI unless the caller reports it itself.
   * @param options - what the caller asks of the sync beyond what the revisions decide
   */
  async fullVaultSync(options?: FullVaultSyncRequest): Promise<FullVaultSyncResult> {
    const result = await fullVaultSyncInternal(options);
    if (options?.reportErrorToPopup !== false) {
      await persistSyncErrorState(result);
    }
    return result;
  },

  /**
   * Whether the stored vault still needs a migration before it can be used.
   */
  async requiresManifestMigration(): Promise<boolean> {
    return vaultRequiresManifestMigration(await createVaultSqliteClient());
  },

  /**
   * Classify the pending migration.
   */
  getVaultMigrationStatus(): Promise<VaultMigrationKind> {
    return vaultSync.getVaultMigrationStatus();
  },

  /**
   * Upgrade the local vault to the current storage model and push it.
   */
  migrateVaultManifest(): Promise<VaultManifestMigrationResult> {
    return vaultSync.migrateVaultManifest();
  },
};
