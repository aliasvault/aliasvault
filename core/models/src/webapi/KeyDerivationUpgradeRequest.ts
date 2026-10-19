/**
 * Request for POST /v2/Auth/key-derivation-upgrade.
 */
export type KeyDerivationUpgradeRequest = {
  currentClientPublicEphemeral: string;
  currentClientSessionProof: string;
  newPasswordVerifier: string;
  newEncryptedAccountKey: string;
  newEncryptedAccountKeyAlgorithm: string;
  newEncryptionType: string;
  newEncryptionSettings: string;
};
