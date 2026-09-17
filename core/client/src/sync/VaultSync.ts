/**
 * The vault sync wrapper: one method per engine operation, adoption of what the engine reported, and the mapping of
 * its failures into the result the UI reads. The driver below it is VaultSyncEngine, which turns the Rust engine's
 * commands into host actions.
 *
 * When updating this logic, make sure to update the same logic on the other platforms:
 * - core/client/src/sync/VaultSync.ts (shared core client for web apps)
 * - apps/mobile-app/ios/VaultStoreKit/Services/VaultSync.swift
 * - apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/VaultSync.kt
 */

import { CapabilityService } from '../api/CapabilityService';
import { AppErrorCode, extractErrorCode, isErrorCode } from '../api/errors/AppErrorCodes';
import { WebApiService } from '../api/WebApiService';
import { VaultKeyService } from '../auth/VaultKeyService';
import { StorageKeys } from '../constants/StorageKeys';
import { getPlatform } from '../platform/ClientPlatform';
import { devError, devLog, devWarn } from '../platform/Logger';
import { TranslatableMessage } from '../platform/TranslatableMessage';

import { VaultMigrationKind } from './VaultManifestMigration';
import { buildVaultSyncRequest, runVaultSyncEngine } from './VaultSyncEngine';

import type { IVaultSyncEngineHost, VaultSyncEmailRouting, VaultSyncEngineResult, VaultSyncEngineResultBase, VaultSyncMigrateManifestResult, VaultSyncMigrationStatusResult, VaultSyncOperation, VaultSyncOptions, VaultSyncResolveVaultKeyResult, VaultSyncStatusCheckResult } from './VaultSyncEngine';
import type { SqliteClient } from '../database/SqliteClient';

/**
 * What a failed sync reports, in the form the UI translates for display.
 */
export type SyncErrorDetail = {
  errorKey?: string;
  errorCode?: string;
  error?: string;
};

/**
 * Result of a full vault sync as the UI reads it.
 */
export type FullVaultSyncResult = SyncErrorDetail & {
  success: boolean;
  hasNewVault: boolean;
  wasOffline: boolean;
  sqliteBlobUpgradeRequired: boolean;
  manifestMigrationRequired?: boolean;
  requiresLogout: boolean;
};

/**
 * Result of the manifest migration as the UI reads it.
 */
export type VaultManifestMigrationResult = SyncErrorDetail & {
  success: boolean;
  pushed: boolean;
};

/** What every engine result may report for the host to persist. */
type AdoptableSyncResult = VaultSyncEngineResultBase & {
  serverVersion?: string;
  capabilities?: Record<string, string>;
  isOfflineMode?: boolean;
  emailRouting?: VaultSyncEmailRouting;
};

/** The engine's failure fields. */
type EngineFailure = Pick<VaultSyncEngineResult, 'error' | 'errorCode' | 'errorKey'>;

/**
 * The `common.errors` key that translates a sync logout reason.
 */
const LOGOUT_REASON_ERROR_KEYS: Record<string, string> = {
  clientVersionNotSupported: 'clientVersionNotSupported',
  serverVersionNotSupported: 'serverVersionNotSupported',
  sessionExpired: 'sessionExpired',
  passwordChanged: 'passwordChanged',
  vaultVersionIncompatible: 'browserExtensionOutdated',
};

/**
 * Whether a sync outcome carries a failure the user should be told about.
 * @param detail - the sync outcome
 */
export function hasSyncError(detail: SyncErrorDetail): boolean {
  return detail.errorKey !== undefined || detail.errorCode !== undefined || detail.error !== undefined;
}

/**
 * Build a sync result.
 * @param overrides - the fields that differ from an uneventful, successful sync
 */
export function syncResult(overrides: Partial<FullVaultSyncResult> = {}): FullVaultSyncResult {
  return { success: true, hasNewVault: false, wasOffline: false, sqliteBlobUpgradeRequired: false, requiresLogout: false, ...overrides };
}

/**
 * Runs the sync engine's operations for one host and adopts what each one reported.
 */
export class VaultSync {
  /**
   * Create the wrapper.
   * @param host - how the engine reaches the local vault and the at-rest blob
   * @param openVault - the open local vault, for the checks that precede an operation
   * @param webApi - the API the engine's HTTP commands run on
   */
  public constructor(private readonly host: IVaultSyncEngineHost, private readonly openVault: () => Promise<SqliteClient>, private readonly webApi: WebApiService = new WebApiService()) {}

  /**
   * Full vault sync: status check, then pull (and merge) or push as the server and local revisions decide. Never throws.
   * @param options - what the caller asks beyond what the revisions decide
   */
  public async syncVaultWithServer(options: VaultSyncOptions = {}): Promise<FullVaultSyncResult> {
    try {
      const storage = getPlatform().storage;
      const [username, accessToken, unlockKey] = await Promise.all([storage.get<string>(StorageKeys.USERNAME), storage.get<string>(StorageKeys.ACCESS_TOKEN), VaultKeyService.getSessionUnlockKey()]);
      if (username === null || accessToken === null) {
        return syncResult({ success: false });
      }
      if (!unlockKey) {
        return syncResult({ success: false, errorCode: AppErrorCode.VAULT_LOCKED });
      }

      const result = await this.run<VaultSyncEngineResult>('fullSync', options);
      return {
        success: result.success,
        hasNewVault: result.hasNewVault,
        wasOffline: result.wasOffline,
        sqliteBlobUpgradeRequired: result.sqliteBlobUpgradeRequired,
        manifestMigrationRequired: result.manifestMigrationRequired,
        requiresLogout: result.requiresLogout,
        ...VaultSync.syncError(result),
      };
    } catch (error) {
      return this.failedSync(VaultSync.driverError(error));
    }
  }

  /**
   * One status call: whether the server holds newer state than this device.
   */
  public async checkVaultVersion(): Promise<VaultSyncStatusCheckResult> {
    const result = await this.run<VaultSyncStatusCheckResult>('statusCheck');
    await getPlatform().storage.set(StorageKeys.IS_OFFLINE_MODE, result.isOffline);
    return result;
  }

  /**
   * Resolve the vault key right after login: the engine opens the account's key chain with the unlock key (the
   * cached chain when the server cannot be reached) and caches it as-is.
   * @param unlockKeyBase64 - the password-derived key (KEK)
   */
  public async resolveVaultKey(unlockKeyBase64: string): Promise<VaultSyncResolveVaultKeyResult> {
    return this.run<VaultSyncResolveVaultKeyResult>('resolveVaultKey', {}, unlockKeyBase64);
  }

  /**
   * Classify the pending manifest migration as the engine sees it. A vault still on the sqlite-blob chain classifies
   * as none; a classification that fails assumes the migration crosses the storage format (the app asks first).
   */
  public async getVaultMigrationStatus(): Promise<VaultMigrationKind> {
    try {
      const status = await this.run<VaultSyncMigrationStatusResult>('migrationStatus');
      return status.kind as VaultMigrationKind;
    } catch (error) {
      devWarn('[ManifestMigration] Could not classify the pending migration, assuming it crosses the storage format:', error);
      return VaultMigrationKind.StorageFormatUpgrade;
    }
  }

  /**
   * Bring the local vault onto the current storage model (a schema rebuild after an app update, or the one-time
   * account-key upgrade of a legacy vault) and push it. Driven by the app's upgrade page only: a sync never runs
   * it on its own, because the storage format move signs out every other client that predates the format. Never throws.
   */
  public async migrateVaultManifest(): Promise<VaultManifestMigrationResult> {
    try {
      if (!await VaultKeyService.getSessionUnlockKey()) {
        return { success: false, pushed: false, errorCode: AppErrorCode.VAULT_LOCKED };
      }
      if (await (await this.openVault()).requiresLegacySqliteBlobMigration()) {
        // The sqlite-blob upgrade chain has to bring the vault to 2.0.0 first; the codec cannot canonicalize what came before.
        return { success: false, pushed: false, error: await getPlatform().translate(TranslatableMessage.VaultUpgradeRequired) };
      }

      const result = await this.run<VaultSyncMigrateManifestResult>('migrateManifest');
      if (result.success) {
        devLog(result.pushed ? '[ManifestMigration] Migration pushed to the server.' : '[ManifestMigration] Migration stored locally; the vault stays dirty for the next sync.');
      }
      return { success: result.success, pushed: result.pushed, ...VaultSync.syncError(result) };
    } catch (error) {
      return this.failedMigration(VaultSync.driverError(error));
    }
  }

  /**
   * Run one engine operation and adopt what it reported.
   * @param operation - the operation
   * @param options - what the caller asks beyond what the engine decides
   * @param encryptionKey - the request key of the one operation that runs on the unlock key itself (resolveVaultKey)
   */
  private async run<T extends VaultSyncEngineResultBase>(operation: VaultSyncOperation, options: VaultSyncOptions = {}, encryptionKey?: string): Promise<T> {
    const request = await buildVaultSyncRequest(operation, options);
    if (encryptionKey) {
      request.encryptionKey = encryptionKey;
    }
    const result = await runVaultSyncEngine<T>(this.host, request, this.webApi);
    await this.adoptSyncResult(result);
    return result;
  }

  /**
   * Persist what the engine reported: server version and capabilities, offline mode, session values it changed, and
   * the email routing a pulled vault came with.
   * @param result - the engine's outcome
   */
  private async adoptSyncResult(result: AdoptableSyncResult): Promise<void> {
    const storage = getPlatform().storage;
    if (result.serverVersion && result.serverVersion !== '0.0.0') {
      await storage.set(StorageKeys.SERVER_VERSION, result.serverVersion);
    }
    if (result.capabilities) {
      await CapabilityService.storeCapabilities(result.capabilities);
    }
    if (result.isOfflineMode !== undefined) {
      await storage.set(StorageKeys.IS_OFFLINE_MODE, result.isOfflineMode);
    }
    if (result.emailRouting) {
      await storage.setMany([
        { key: StorageKeys.PUBLIC_EMAIL_DOMAINS, value: result.emailRouting.publicEmailDomainList },
        { key: StorageKeys.PRIVATE_EMAIL_DOMAINS, value: result.emailRouting.privateEmailDomainList },
        { key: StorageKeys.HIDDEN_PRIVATE_EMAIL_DOMAINS, value: result.emailRouting.hiddenPrivateEmailDomainList },
      ]);
    }
  }

  /**
   * A failed sync return.
   * @param detail - the failure
   */
  private failedSync(detail: SyncErrorDetail): FullVaultSyncResult {
    devError(`[VaultSync] Sync failed (${detail.errorCode ?? 'no code'}): ${detail.error ?? 'no detail'}`);
    return syncResult({ success: false, ...detail });
  }

  /**
   * A failed migration return.
   * @param detail - the failure
   */
  private failedMigration(detail: SyncErrorDetail): VaultManifestMigrationResult {
    devError(`[ManifestMigration] Manifest migration failed (${detail.errorCode ?? 'no code'}): ${detail.error ?? 'no detail'}`);
    return { success: false, pushed: false, ...detail };
  }

  /**
   * An error the driver itself threw (a request it could not build, a command it could not decode).
   * @param error - what was thrown
   */
  private static driverError(error: unknown): SyncErrorDetail {
    const message = error instanceof Error ? error.message : String(error);
    return { errorCode: extractErrorCode(message) ?? AppErrorCode.UNKNOWN_ERROR, error: message };
  }

  /**
   * The engine's failure as the UI names it: the logout reason as a translation key, or the error code of an ordinary
   * failure. Empty when the result names no failure.
   * @param result - the engine's outcome
   */
  private static syncError(result: EngineFailure): SyncErrorDetail {
    if (!result.error && !result.errorCode && !result.errorKey) {
      return {};
    }

    devWarn(`[VaultSync] Engine failure (${result.errorCode ?? 'no code'}): ${result.error ?? 'no detail'}`);

    if (result.errorKey) {
      return { errorKey: LOGOUT_REASON_ERROR_KEYS[result.errorKey] ?? 'unknownError' };
    }

    return { errorCode: result.errorCode && isErrorCode(result.errorCode) ? result.errorCode : AppErrorCode.UNKNOWN_ERROR, error: result.error };
  }
}
