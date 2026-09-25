/**
 * Diagnostics helper functions to log errors and warnings centrally.
 *
 * See {@link isExpectedFailure} for the classification of API failures.
 */

/**
 * Report a failure that means this build has a defect. Reaches the browser's extension error list.
 * @param message - what failed, e.g. 'Vault merge failed'
 * @param error - the underlying error, when there is one
 */
export function logDefect(message: string, error?: unknown): void {
  if (error === undefined) {
    console.error(message);
    return;
  }
  console.error(message, error);
}

/**
 * Report a failure the environment can cause on its own. Stays out of the browser's extension error list.
 * @param message - what failed, e.g. 'Status check failed, going offline'
 * @param error - the underlying error, when there is one
 */
export function logExpected(message: string, error?: unknown): void {
  if (error === undefined) {
    console.warn(message);
    return;
  }
  console.warn(message, error);
}
