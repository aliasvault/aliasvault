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

  /**
   * The error for a failed response, carrying the structured API error code (e.g. "USER_NOT_FOUND") when the body names one.
   * @param response - The failed response
   */
  public static async fromResponse(response: Response): Promise<ApiRequestError> {
    return new ApiRequestError(response.status, await extractApiErrorCode(response));
  }
}

/**
 * The structured API error code of a failed request, or null for any other error.
 * @param error - The thrown error
 */
export function apiErrorCodeOf(error: unknown): string | null {
  return error instanceof ApiRequestError ? error.apiErrorCode : null;
}

/**
 * Extract the structured API error code from an error response body.
 * @param response - The failed response
 */
async function extractApiErrorCode(response: Response): Promise<string | null> {
  try {
    const body = await response.clone().json() as { code?: unknown; title?: unknown };
    for (const value of [body.code, body.title]) {
      // Server error codes are uppercase enum names.
      if (typeof value === 'string' && /^[A-Z0-9_]{2,64}$/.test(value)) {
        return value;
      }
    }
  } catch {
    // Body is empty or not JSON (e.g. proxy error page).
  }
  return null;
}
