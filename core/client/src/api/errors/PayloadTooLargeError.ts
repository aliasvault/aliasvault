/**
 * Thrown when the server rejects a request with HTTP 413 (Request Entity Too Large).
 * For vault uploads this signals the encrypted vault exceeds the server's MAX_UPLOAD_SIZE_MB limit.
 */
export class PayloadTooLargeError extends Error {
  /**
   * Creates a new instance of PayloadTooLargeError.
   *
   * @param message - The error message.
   */
  public constructor(message: string) {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}
