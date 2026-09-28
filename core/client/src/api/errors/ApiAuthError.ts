/**
 * Thrown when the session is no longer valid (token refresh refused), which logs the user out.
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
