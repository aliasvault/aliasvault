/**
 * Auth Log model.
 */
export type AuthLogModel = {
  /**
   * Gets or sets the primary key for the auth log entry.
   */
  id: number;

  /**
   * Gets or sets the timestamp of the auth log entry.
   */
  timestamp: string;

  /**
   * Gets or sets the type of authentication event.
   */
  eventType: number;

  /**
   * Gets or sets the username associated with the auth log entry.
   */
  username: string;

  /**
   * Gets or sets the IP address from which the authentication attempt was made.
   */
  ipAddress: string;

  /**
   * Gets or sets the user agent string of the device used for the authentication attempt.
   */
  userAgent: string;

  /**
   * Gets or sets the client application name and version.
   */
  client: string;

  /**
   * Gets or sets a value indicating whether the authentication attempt was successful.
   */
  isSuccess: boolean;
}
