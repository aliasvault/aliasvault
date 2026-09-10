/**
 * Thrown when the AliasVault server does not expose the v2 vault API (the v2 endpoints return HTTP 404).
 */
export class ServerUpdateRequiredError extends Error {
  /**
   * Creates a new instance of ServerUpdateRequiredError.
   * @param message - The error message.
   */
  public constructor(message: string = 'The AliasVault server does not support the v2 vault API and needs to be updated') {
    super(message);
    this.name = 'ServerUpdateRequiredError';
    Object.setPrototypeOf(this, ServerUpdateRequiredError.prototype);
  }
}
