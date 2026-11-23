/**
 * Raised for a 2FA code AliasVault cannot generate: HOTP, Steam, Yandex, mOTP, or TOTP with unsupported parameters.
 * Its message names the code type or parameters only, never item content, so the import failure list shows it.
 */
export class UnsupportedOtpCodeError extends Error {
  /**
   * Create the error.
   * @param message - What is not supported
   */
  public constructor(message: string) {
    super(message);
    this.name = 'UnsupportedOtpCodeError';
    Object.setPrototypeOf(this, UnsupportedOtpCodeError.prototype);
  }
}
