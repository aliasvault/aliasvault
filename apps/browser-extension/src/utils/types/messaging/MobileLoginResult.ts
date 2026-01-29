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
   * The vault decryption key (base64 encoded).
   */
  decryptionKey: string;

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
