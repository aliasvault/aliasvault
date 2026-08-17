/**
 * Thrown when the server rejects the request with HTTP 426 because this app version is too old to
 * access the account.
 */
export class ClientUpgradeRequiredError extends Error {
  /**
   * Creates a new instance of ClientUpgradeRequiredError.
   */
  public constructor() {
    super('HTTP 426: client version no longer supported by the server');
    this.name = 'ClientUpgradeRequiredError';
  }
}
