/**
 * Thrown when the server rejects the request with HTTP 426 because this client is not supported
 * anymore by the server (for the specific account).
 */
export class ClientUpgradeRequiredError extends Error {
  /**
   * Creates a new instance of ClientUpgradeRequiredError.
   */
  public constructor() {
    super('HTTP 426: client version no longer supported by the server');
    this.name = 'ClientUpgradeRequiredError';
    Object.setPrototypeOf(this, ClientUpgradeRequiredError.prototype);
  }
}
