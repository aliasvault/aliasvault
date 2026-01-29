/**
 * These parameters for deriving encryption key from plain text password. These are stored
 * as metadata in the vault upon initial login, and are used to derive the encryption key
 * from the plain text password in the unlock screen.
 */
export type EncryptionKeyDerivationParams = {
  encryptionType: string,
  encryptionSettings: string,
  salt: string,
};
