/**
 * Result of a successful mobile login containing decrypted authentication data.
 */
export type MobileLoginResult = {
  /**
   * The username.
   */
  username: string;

  /**
   * The JWT access token.
   */
  token: string;

  /**
   * The refresh token.
   */
  refreshToken: string;

  /**
   * The account unlock key the mobile app sent.
   */
  unlockKey: string;

  /**
   * The user's salt for key derivation.
   */
  salt: string;

  /**
   * The encryption type (e.g., "Argon2id").
   */
  encryptionType: string;

  /**
   * The encryption settings JSON string.
   */
  encryptionSettings: string;
}
