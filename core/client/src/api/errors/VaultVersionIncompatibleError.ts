/**
 * Custom error class for vault version incompatibility issues.
 * Thrown when the browser extension is outdated and cannot handle the vault version.
 */
export class VaultVersionIncompatibleError extends Error {
  /**
   * Creates a new instance of the VaultVersionIncompatibleError class.
   * @param message - The error message.
   */
  public constructor(message: string) {
    super(message);
    this.name = 'VaultVersionIncompatibleError';
    Object.setPrototypeOf(this, VaultVersionIncompatibleError.prototype);
  }
}
