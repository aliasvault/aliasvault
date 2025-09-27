/**
 * Custom error class for vault authentication errors.
 * Thrown when the vault sync fails due to authentication issues.
 */
export class VaultAuthenticationError extends Error {
  /**
   * Creates a new instance of VaultAuthenticationError.
   *
   * @param message - The error message (translation key or translated message).
   */
  public constructor(message: string) {
    super(message);
    this.name = 'VaultAuthenticationError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, VaultAuthenticationError);
    }
  }
}
