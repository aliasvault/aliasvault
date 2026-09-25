/**
 * Diagnostics helper functions to log errors and warnings centrally.
 */

import { AppErrorCode } from '@aliasvault/client/api/errors/AppErrorCodes';
import { isExpectedFailure } from '@aliasvault/client/api/errors/ExpectedFailure';
import { logDefect, logExpected } from '@aliasvault/client/utilities/Diagnostics';

/**
 * Common messages the browser produces when a message crosses to a context that is not there (any more).
 * These are routinely expected during normal lifecycle events, and do not indicate a defect.
 */
const LIFECYCLE_FAILURE_MESSAGES = [
  'could not establish connection',
  'receiving end does not exist',
  'extension context invalidated',
  'message port closed',
  'no tab with id',
  'no window with id',
  'the browser is shutting down',
  'only a single offscreen document',
];

/**
 * Error codes that, on a sync or migration outcome, name something the environment did rather than a defect.
 */
const EXPECTED_ERROR_CODES = new Set<string>([
  AppErrorCode.SYNC_SERVER_UNREACHABLE,
  AppErrorCode.SYNC_SERVER_ERROR,
  AppErrorCode.UPLOAD_OUTDATED,
  AppErrorCode.UPLOAD_TIMEOUT,
  AppErrorCode.UPLOAD_TOO_LARGE,
  AppErrorCode.SERVER_UPDATE_REQUIRED,
  AppErrorCode.VERSION_INCOMPATIBLE,
]);

/**
 * Whether a failed sync or migration outcome names an expected condition.
 * @param error - the value to inspect
 */
function isExpectedOutcome(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { errorCode?: unknown }).errorCode;
  return typeof code === 'string' && EXPECTED_ERROR_CODES.has(code);
}

/**
 * Whether a failure is the browser tearing a context down rather than a defect.
 * @param error - the error to inspect
 */
function isLifecycleFailure(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return LIFECYCLE_FAILURE_MESSAGES.some(candidate => message.includes(candidate));
}

/**
 * Whether a failure is one the environment can cause on its own.
 * @param error - the error to classify
 */
export function isExpectedExtensionFailure(error: unknown): boolean {
  return isExpectedFailure(error) || isLifecycleFailure(error) || isExpectedOutcome(error);
}

/**
 * Report a failure to the channel its classification calls for.
 * @param message - what failed, e.g. '[Autofill] Reading the vault failed'
 * @param error - the error to classify and report
 */
export function logFailure(message: string, error: unknown): void {
  if (isExpectedExtensionFailure(error)) {
    logExpected(message, error);
    return;
  }
  logDefect(message, error);
}

export { logDefect, logExpected };
