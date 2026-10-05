/**
 * The body of every V2 API error response.
 */
export type ApiErrorResponse = {
  /**
   * The error code, e.g. "GROUP_NOT_FOUND". Clients branch on and translate this.
   */
  code: string;

  /**
   * The HTTP status code of the response.
   */
  statusCode: number;

  /**
   * Optional structured context, absent when there is none.
   */
  details?: Record<string, unknown>;
};
