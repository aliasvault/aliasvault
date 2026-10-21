import { apiErrorCodeOf } from '@aliasvault/client/api/errors/ApiRequestError';
import { AppErrorCode, formatErrorWithCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { familySharingText, sharingErrorMessage } from '@aliasvault/client/sharing/FamilySharingView';

import type { SharingOperationResult } from '@aliasvault/client/sync/VaultSync';
import type { TFunction } from 'i18next';

/**
 * Error thrown by a failed sharing operation, carrying the message to show.
 */
export class SharingOperationError extends Error {}

/**
 * The message to show for a failed sharing action.
 * @param error - the error thrown by the call.
 * @param fallback - the message for an error the sharing screens have no words for.
 */
export function sharingFailureMessage(error: unknown, fallback: string): string {
  if (error instanceof SharingOperationError) {
    return error.message;
  }

  const code = apiErrorCodeOf(error);
  return sharingErrorMessage(code) ?? (code !== null ? `${fallback} [${code}]` : fallback);
}

/**
 * Throw the error a failed sync engine sharing operation stands for.
 * @param result - what the operation returned.
 * @param fallback - the message for a failure without a more specific reason.
 * @param t - the translation function.
 */
export function unwrapSharingResult(result: SharingOperationResult, fallback: string, t: TFunction): void {
  if (result.success) {
    return;
  }

  if (result.vaultUpgradeRequired) {
    throw new SharingOperationError(familySharingText.errors.vaultUpgradeRequired);
  }

  if (result.errorCode === AppErrorCode.VAULT_LOCKED) {
    throw new SharingOperationError(formatErrorWithCode(t('common.errors.vaultIsLocked'), AppErrorCode.VAULT_LOCKED));
  }

  const code = result.apiErrorCode ?? result.error;
  throw new SharingOperationError(sharingErrorMessage(result.apiErrorCode) ?? (code ? `${fallback} [${code}]` : fallback));
}
