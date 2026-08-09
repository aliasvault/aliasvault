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

  /**
   * Get one manifest's active keypair: the key whose public half is published for SMTP delivery. Passed
   * the root manifest's id, this is the user's personal keypair — `IsPrimary` alone would not identify it,
   * as every manifest has a primary row of its own.
   */
  public static readonly GET_ACTIVE_FOR_MANIFEST = `
    SELECT
      x.Id,
      x.PublicKey,
      x.PrivateKey,
      x.IsPrimary
    FROM EncryptionKeys x
    WHERE x.ManifestId = ? AND x.IsPrimary = 1 AND x.IsDeleted = 0
    LIMIT 1`;

  /**
   * Demote a manifest's current keypair. Rotation demotes rather than deletes, so mail received before the
   * rotation stays decryptable by the members who still hold the folder.
   */
  public static readonly DEMOTE_FOR_MANIFEST = `
    UPDATE EncryptionKeys
    SET IsPrimary = 0, UpdatedAt = ?
    WHERE ManifestId = ? AND IsPrimary = 1`;

  /**
   * Insert a manifest's new active keypair, stamped with the manifest's id so the codec routes it into that
   * manifest (private half encrypted under the manifest's VEK, readable by exactly its members).
   */
  public static readonly INSERT_FOR_MANIFEST = `
    INSERT INTO EncryptionKeys (Id, ManifestId, PublicKey, PrivateKey, IsPrimary, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, 1, ?, ?, 0)`;
}
