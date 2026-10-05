/**
 * Request for POST /v2/Auth/change-password.
 */
export type PasswordChangeRequest = {
  currentClientPublicEphemeral: string;
  currentClientSessionProof: string;
  newPasswordSalt: string;
  newPasswordVerifier: string;
  newEncryptedAccountKey: string;
  newEncryptedAccountKeyAlgorithm: string;
  newEncryptionType: string;
  newEncryptionSettings: string;
};
