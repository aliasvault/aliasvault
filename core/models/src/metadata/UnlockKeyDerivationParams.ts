/**
 * The parameters for deriving the unlock key (the KEK) from the plain text master password. Stored on the device
 * upon login, so the unlock screen can derive the same key again, also offline.
 */
export type UnlockKeyDerivationParams = {
  encryptionType: string,
  encryptionSettings: string,
  salt: string,
};
