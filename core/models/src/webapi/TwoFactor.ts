/**
 * Response of GET /v2/TwoFactorAuth/status.
 */
export type TwoFactorStatusResponse = {
  /**
   * Whether two-factor authentication is enabled.
   */
  twoFactorEnabled: boolean;
}

/**
 * Response of POST /v2/TwoFactorAuth/enable.
 */
export type TwoFactorEnableResponse = {
  /**
   * The authenticator secret.
   */
  secret: string;

  /**
   * The otpauth URL to render as a QR code.
   */
  qrCodeUrl: string;
}

/**
 * Response of POST /v2/TwoFactorAuth/verify.
 */
export type TwoFactorVerifyResponse = {
  /**
   * The newly generated recovery codes.
   */
  recoveryCodes: string[];
}

/**
 * Request of POST /v2/TwoFactorAuth/verify and /v2/TwoFactorAuth/disable.
 */
export type TwoFactorCodeRequest = {
  /**
   * The authenticator code, or for disable also an unused recovery code.
   */
  code: string;
}
