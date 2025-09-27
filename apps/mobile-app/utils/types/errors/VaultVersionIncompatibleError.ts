/**
 * Custom error class for vault version incompatibility issues.
 * Thrown when the mobile app is outdated and cannot handle the vault version.
 */
export class VaultVersionIncompatibleError extends Error {
  /**
   * Creates a new instance of the VaultVersionIncompatibleError class.
   * @param message - The error message.
   */
  public constructor(message: string) {
    super(message);
    this.name = 'VaultVersionIncompatibleError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, VaultVersionIncompatibleError);
    }
  }
}
