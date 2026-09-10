/**
 * Custom error class for API authentication-related errors.
 */
export class ApiAuthError extends Error {
  /**
   * Creates a new instance of ApiAuthError.
   *
   * @param message - The error message.
   */
  public constructor(message: string) {
    super(message);
    this.name = 'ApiAuthError';
  }
}
