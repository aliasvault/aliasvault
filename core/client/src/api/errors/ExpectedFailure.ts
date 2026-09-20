import { logDefect, logExpected } from '../../utilities/Diagnostics';

import { ApiAuthError } from './ApiAuthError';
import { ApiRequestError } from './ApiRequestError';
import { ClientUpgradeRequiredError } from './ClientUpgradeRequiredError';
import { NetworkError } from './NetworkError';
import { PayloadTooLargeError } from './PayloadTooLargeError';
import { ServerUpdateRequiredError } from './ServerUpdateRequiredError';

/**
 * HTTP statuses that fall into expected failure categories and describe server behavior instead of client error.
 */
const EXPECTED_STATUS_CODES = new Set([401, 403, 404, 409, 413, 426, 429]);

/**
 * Whether an error is an abort: a timeout signal firing, the popup closing mid-request, or a caller cancelling.
 * @param error - the error to inspect
 */
function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/**
 * Whether a failure is one the environment can cause on its own.
 * @param error - the error to classify
 */
export function isExpectedFailure(error: unknown): boolean {
  // NetworkError also covers RequestTimeoutError, which extends it.
  if (error instanceof NetworkError || error instanceof ApiAuthError || error instanceof PayloadTooLargeError) {
    return true;
  }
  if (error instanceof ClientUpgradeRequiredError || error instanceof ServerUpdateRequiredError) {
    return true;
  }
  if (error instanceof ApiRequestError) {
    return error.statusCode >= 500 || EXPECTED_STATUS_CODES.has(error.statusCode);
  }
  return isAbort(error);
}

/**
 * Report a failure on the channel its classification calls for: {@link logExpected} for anything the
 * environment can cause, {@link logDefect} for the rest.
 * @param message - what failed, e.g. 'Vault sync failed'
 * @param error - the error to classify and report
 */
export function logFailure(message: string, error: unknown): void {
  if (isExpectedFailure(error)) {
    logExpected(message, error);
    return;
  }
  logDefect(message, error);
}
