/**
 * Response of GET /v2/KeyRotation/initiate: the SRP challenge for the current password and the key generations a
 * rotation starts from.
 */
export type KeyRotationInitiateResponse = {
  salt: string;
  serverEphemeral: string;
  encryptionType: string;
  encryptionSettings: string;
  srpIdentity: string;
  userId: string;
  accountKeyVersion: number;
  personalManifestId: string;
  manifestKeyVersion: number;
};

