/**
 * A login failure detected on the device, whose message is shown to the user as-is.
 */
export class LocalAuthError extends Error {
  /**
   * Creates a new instance of LocalAuthError.
   *
   * @param message - The error message.
   */
  public constructor(message: string) {
    super(message);
    this.name = 'LocalAuthError';
  }
}
