import { apiErrorCodeOf } from '@aliasvault/client/api/errors/ApiRequestError';
import { familySharingText, sharingErrorMessage } from '@aliasvault/client/sharing/FamilySharingView';

import NativeVaultManager from '@/specs/NativeVaultManager';

import type { VaultSyncSharingOperation } from '@aliasvault/client/sync/VaultSyncEngine';

/** What a native sharing operation answers. */
export type NativeSharingResult = Awaited<ReturnType<typeof NativeVaultManager.runSharingOperation>>;

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
 * Throw the error a failed native sharing operation stands for.
 * @param result - what the operation returned.
 * @param fallback - the message for a failure without a more specific reason.
 */
export function unwrapSharingResult(result: NativeSharingResult, fallback: string): NativeSharingResult {
  if (result.success) {
    return result;
  }

  if (result.vaultUpgradeRequired) {
    throw new SharingOperationError(familySharingText.errors.vaultUpgradeRequired);
  }

  const code = result.apiErrorCode ?? result.error;
  throw new SharingOperationError(sharingErrorMessage(result.apiErrorCode) ?? (code ? `${fallback} [${code}]` : fallback));
}

/**
 * Run one of the native sync engine's sharing operations, which hold the keys the JS side never sees.
 * @param operation - the engine operation.
 * @param params - what it acts on.
 * @param fallback - the message for a failure without a more specific reason.
 */
export async function runSharingOperation(operation: VaultSyncSharingOperation, params: Record<string, string | undefined>, fallback: string): Promise<NativeSharingResult> {
  return unwrapSharingResult(await NativeVaultManager.runSharingOperation(operation, JSON.stringify(params)), fallback);
}
