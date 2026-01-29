/**
 * Represents a password change initiate response.
 */
export type PasswordChangeInitiateResponse = {
  salt: string;
  serverEphemeral: string;
  encryptionType: string;
  encryptionSettings: string;
  srpIdentity?: string;
};
