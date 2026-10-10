import { AppErrorCode, formatErrorWithCode, getErrorTranslationKey, hasOwnErrorMessage, isErrorCode } from '../api/errors/AppErrorCodes';

import { hasSyncError, logoutReasonKey, type SyncErrorDetail } from './VaultSync';

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
 * The message to show for a failed sync, or undefined when the outcome names no failure. The engine's technical
 * detail is only appended to a code that has no message of its own.
 * @param detail - the sync outcome
 * @param t - the renderer's translation function
 */
export function syncErrorMessage(detail: SyncErrorDetail, t: (key: string) => string): string | undefined {
  if (detail.logoutReason) {
    return t(logoutReasonKey(detail.logoutReason));
  }
  if (detail.errorCode) {
    const code = isErrorCode(detail.errorCode) ? detail.errorCode : AppErrorCode.UNKNOWN_ERROR;
    const message = formatErrorWithCode(t(getErrorTranslationKey(code)), code);
    return detail.error && !hasOwnErrorMessage(code) ? `${message}\n${detail.error}` : message;
  }
  return detail.error;
}

/**
 * The engine's technical detail that {@link syncErrorMessage} leaves out, for a copyable error report.
 * @param detail - the sync outcome
 */
export function syncErrorReportDetail(detail: SyncErrorDetail): string | undefined {
  if (detail.logoutReason || !detail.errorCode || !detail.error) {
    return undefined;
  }
  const code = isErrorCode(detail.errorCode) ? detail.errorCode : AppErrorCode.UNKNOWN_ERROR;
  return hasOwnErrorMessage(code) ? detail.error : undefined;
}

/**
 * The copyable report for a failed sync: the message, followed by the engine's technical detail on its own line.
 * @param detail - the sync outcome
 * @param t - the renderer's translation function
 */
export function syncErrorReport(detail: SyncErrorDetail, t: (key: string) => string): string | undefined {
  const message = syncErrorMessage(detail, t);
  const technicalDetail = syncErrorReportDetail(detail);
  return message && technicalDetail ? `${message}\n${technicalDetail}` : message;
}
