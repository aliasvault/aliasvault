/**
 * Error codes for mobile login operations.
 * These codes are used to provide translatable error messages to users.
 */
export enum MobileLoginErrorCode {
  /**
   * The mobile login request has timed out after 2 minutes.
   */
  TIMEOUT = 'TIMEOUT',

  /**
   * A generic error occurred during mobile login.
   */
  GENERIC = 'GENERIC',
}
