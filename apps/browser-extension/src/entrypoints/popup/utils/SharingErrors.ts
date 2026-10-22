import { apiErrorCodeOf } from '@aliasvault/client/api/errors/ApiRequestError';
import { sharingErrorMessage } from '@aliasvault/client/sharing/SharingView';

import type { SharingActionResponse } from '@/entrypoints/background/VaultMessageHandler';

/**
 * Error thrown by a failed sharing operation, carrying the message to show.
 */
export class SharingOperationError extends Error {}

/** A failure the background script reported as a bare API error code. */
class SharingApiError extends Error {}

/**
 * The message to show for a failed sharing action.
 * @param error - the error thrown by the call.
 * @param fallback - the message for an error the sharing screens have no words for.
 */
export function sharingFailureMessage(error: unknown, fallback: string): string {
  if (error instanceof SharingOperationError) {
    return error.message.length > 0 ? error.message : fallback;
  }

  const code = error instanceof SharingApiError ? error.message : apiErrorCodeOf(error);
  return sharingErrorMessage(code) ?? (code !== null ? `${fallback} [${code}]` : fallback);
}

/**
 * Throw the error a failed background sharing answer stands for; the background already put most failures into words.
 * @param result - what the background script answered.
 * @returns The successful answer.
 */
export function unwrapSharingResult(result: SharingActionResponse): SharingActionResponse {
  if (result.success) {
    return result;
  }

  throw result.apiErrorCode ? new SharingApiError(result.apiErrorCode) : new SharingOperationError(result.error ?? '');
}
