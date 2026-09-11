/**
 * Vault sync result mapper that handles the sync engine's outcome and the result the popup reads.
 */

import { AppErrorCode, isErrorCode } from '@aliasvault/client/api/errors/AppErrorCodes';

import { devWarn } from '@/utils/devLogger/DevLogger';
import type { FullVaultSyncResult } from '@/utils/types/messaging/FullVaultSyncResult';
import type { SyncErrorDetail } from '@/utils/types/messaging/SyncErrorDetail';

import type { VaultSyncEngineResult } from '@aliasvault/client/sync/VaultSyncEngine';

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
 * Build a sync result.
 * @param overrides - the fields that differ from an uneventful, successful sync
 */
export function syncResult(overrides: Partial<FullVaultSyncResult> = {}): FullVaultSyncResult {
  return { success: true, hasNewVault: false, wasOffline: false, sqliteBlobUpgradeRequired: false, requiresLogout: false, ...overrides };
}

/**
 * The `common.errors` key for an engine logout reason, `unknownError` for a reason this build does not know.
 * @param reason - the engine's logout reason
 */
export function logoutErrorKey(reason: string): string {
  return LOGOUT_REASON_ERROR_KEYS[reason] ?? 'unknownError';
}

/**
 * What the popup needs to name a sync failure: the logout reason as a translation key, or the error code of an ordinary failure.
 * @param result - the engine's outcome
 */
export function toSyncErrorDetail(result: Pick<VaultSyncEngineResult, 'error' | 'errorCode' | 'errorKey'>): SyncErrorDetail {
  if (!result.error && !result.errorCode && !result.errorKey) {
    return {};
  }

  devWarn(`[VaultSync] Engine failure (${result.errorCode ?? 'no code'}): ${result.error ?? 'no detail'}`);

  if (result.errorKey) {
    return { errorKey: logoutErrorKey(result.errorKey) };
  }

  return { errorCode: result.errorCode && isErrorCode(result.errorCode) ? result.errorCode : AppErrorCode.UNKNOWN_ERROR };
}

/**
 * The full sync as the popup reads it.
 * @param result - the engine's outcome
 */
export function toFullVaultSyncResult(result: VaultSyncEngineResult): FullVaultSyncResult {
  return {
    success: result.success,
    hasNewVault: result.hasNewVault,
    wasOffline: result.wasOffline,
    sqliteBlobUpgradeRequired: result.sqliteBlobUpgradeRequired,
    manifestMigrationRequired: result.manifestMigrationRequired,
    requiresLogout: result.requiresLogout,
    ...toSyncErrorDetail(result),
  };
}
