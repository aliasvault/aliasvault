import { AppErrorCode } from './AppErrorCodes';

/**
 * Custom error class for network-related errors.
 * Used to detect offline scenarios and trigger offline mode.
 *
 * This error is thrown by WebApiService.rawFetch() when fetch() fails due to
 * network issues (offline, DNS, timeout, CORS, etc.). By throwing a proper
 * typed error at the source, we avoid fragile string-matching in error handlers.
 */
export class NetworkError extends Error {
  /** The error code of a request that did not reach the server. */
  public readonly code = AppErrorCode.NETWORK_ERROR;

  /** The API URL the request was sent to, when known. */
  public readonly apiUrl?: string;

  /**
   * Creates a new instance of NetworkError.
   * @param message - The error message.
   * @param cause - The original error that caused this network error.
   * @param apiUrl - The API URL the request was sent to.
   */
  public constructor(message: string = 'Network error', cause?: Error, apiUrl?: string) {
    super(message);
    this.name = 'NetworkError';
    this.cause = cause;
    this.apiUrl = apiUrl;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}
