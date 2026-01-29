/**
 * Represents the error response returned by the API.
 */
export type ApiErrorResponse = {
  /**
   * The main error message.
   */
  message: string;

  /**
   * The error code associated with this error.
   */
  code: string;

  /**
   * Additional details about the error.
   */
  details: Record<string, unknown>;

  /**
   * The HTTP status code associated with this error.
   */
  statusCode: number;

  /**
   * The timestamp when the error occurred.
   */
  timestamp: string; // Using string for ISO date format
};
