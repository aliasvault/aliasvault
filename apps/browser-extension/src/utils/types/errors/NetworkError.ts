/**
 * Custom error class for network-related errors.
 * Used to detect offline scenarios and trigger offline mode.
 *
 * This error is thrown by WebApiService.rawFetch() when fetch() fails due to
 * network issues (offline, DNS, timeout, CORS, etc.). By throwing a proper
 * typed error at the source, we avoid fragile string-matching in error handlers.
 */
export class NetworkError extends Error {
  /**
   * Creates a new instance of NetworkError.
   * @param message - The error message.
   * @param cause - The original error that caused this network error.
   */
  public constructor(message: string = 'Network error', cause?: Error) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}
