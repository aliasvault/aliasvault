import { NetworkError } from './NetworkError';

/**
 * Thrown when an API request is aborted because it exceeded its timeout
 * (see WebApiService.buildTimeoutSignal). Extends NetworkError so generic
 * offline handling still applies, while letting the vault sync flow surface
 * a specific timeout message instead of silently entering offline mode.
 */
export class RequestTimeoutError extends NetworkError {
  /**
   * Creates a new instance of RequestTimeoutError.
   * @param message - The error message.
   * @param cause - The original abort/timeout error.
   */
  public constructor(message: string = 'Request timed out', cause?: Error) {
    super(message, cause);
    this.name = 'RequestTimeoutError';
    Object.setPrototypeOf(this, RequestTimeoutError.prototype);
  }
}
