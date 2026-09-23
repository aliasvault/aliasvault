/**
 * SQL query constants for encryption keypair operations.
 */
export class EncryptionKeyQueries {
  /**
   * Get every keypair in the vault, personal (root-stamped) and shared-manifest-stamped alike. Superseded
   * (rotated) keys are included as well, as mail received before a rotation is still encrypted with them.
   */
  public static readonly GET_ALL = `
    SELECT
      x.PublicKey,
      x.PrivateKey,
      x.IsPrimary
    FROM EncryptionKeys x
    WHERE x.IsDeleted = 0`;
}
