/**
 * Thrown when the server responds to an API request with a non-success HTTP status.
 */
export class ApiRequestError extends Error {
  /** HTTP status code returned by the server. */
  public readonly statusCode: number;

  /** Structured API error code from the response body, if present. */
  public readonly apiErrorCode: string | null;

  /**
   * Creates a new instance of ApiRequestError.
   *
   * @param statusCode - The HTTP status code returned by the server.
   * @param apiErrorCode - The structured API error code from the response body, if present.
   */
  public constructor(statusCode: number, apiErrorCode: string | null = null) {
    super(`HTTP ${statusCode}${apiErrorCode ? `: ${apiErrorCode}` : ''}`);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.apiErrorCode = apiErrorCode;
    Object.setPrototypeOf(this, ApiRequestError.prototype);
  }
}
