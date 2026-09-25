import { AppErrorCode, formatErrorWithCode, getErrorTranslationKey, isErrorCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { hasSyncError, type SyncErrorDetail } from '@aliasvault/client/sync/VaultSync';

import type { TFunction } from 'i18next';

/**
 * The stored sync error, tolerating the plain string an older build left behind.
 * @param value - what came out of storage
 */
export function toSyncErrorDetail(value: unknown): SyncErrorDetail | null {
  if (typeof value === 'string') {
    return { error: value };
  }
  if (value && typeof value === 'object') {
    const detail = value as SyncErrorDetail;
    return hasSyncError(detail) ? detail : null;
  }
  return null;
}

/**
 * The message to show for a failed sync, or undefined when the outcome names no failure.
 * @param detail - the sync outcome
 * @param t - the renderer's translation function
 */
export function syncErrorMessage(detail: SyncErrorDetail, t: TFunction): string | undefined {
  if (detail.errorKey) {
    return t('common.errors.' + detail.errorKey);
  }
  if (detail.errorCode) {
    const code = isErrorCode(detail.errorCode) ? detail.errorCode : AppErrorCode.UNKNOWN_ERROR;
    const message = formatErrorWithCode(t(getErrorTranslationKey(code)), code);
    return detail.error ? `${message}\n${detail.error}` : message;
  }
  return detail.error;
}
