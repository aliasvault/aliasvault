/**
 * Represents a delete account initiate response.
 */
export type DeleteAccountInitiateRequest = {
  username: string;
};

/**
 * Represents a delete account initiate response.
 */
export type DeleteAccountInitiateResponse = {
  salt: string;
  serverEphemeral: string;
  encryptionType: string;
  encryptionSettings: string;
};
