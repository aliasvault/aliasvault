import { FieldKey } from '@aliasvault/models/vault';

/**
 * SQL query constants for Passkey operations.
 * Centralizes all passkey-related queries to avoid duplication.
 */
export class PasskeyQueries {
  /**
   * Get passkeys by relying party ID.
   */
  public static readonly GET_BY_RP_ID = `
    SELECT
      p.Id,
      p.ItemId,
      p.ManifestId,
      p.RpId,
      p.UserHandle,
      p.PublicKey,
      p.PrivateKey,
      p.DisplayName,
      p.PrfKey,
      p.AdditionalData,
      p.CreatedAt,
      p.UpdatedAt,
      p.IsDeleted,
      i.Name as ServiceName,
      (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = '${FieldKey.LoginUsername}' AND fv.IsDeleted = 0 LIMIT 1) as Username,
      (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = '${FieldKey.LoginEmail}' AND fv.IsDeleted = 0 LIMIT 1) as Email
    FROM Passkeys p
    INNER JOIN Items i ON p.ItemId = i.Id AND i.ManifestId = p.ManifestId
    WHERE p.RpId = ? AND p.IsDeleted = 0
      AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
    ORDER BY p.CreatedAt DESC, p.ManifestId`;

  /**
   * Get passkey by ID with item information.
   */
  public static readonly GET_BY_ID_WITH_ITEM = `
    SELECT
      p.Id,
      p.ItemId,
      p.ManifestId,
      p.RpId,
      p.UserHandle,
      p.PublicKey,
      p.PrivateKey,
      p.DisplayName,
      p.PrfKey,
      p.AdditionalData,
      p.CreatedAt,
      p.UpdatedAt,
      p.IsDeleted,
      i.Name as ServiceName,
      (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = '${FieldKey.LoginUsername}' AND fv.IsDeleted = 0 LIMIT 1) as Username,
      (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = '${FieldKey.LoginEmail}' AND fv.IsDeleted = 0 LIMIT 1) as Email
    FROM Passkeys p
    INNER JOIN Items i ON p.ItemId = i.Id AND i.ManifestId = p.ManifestId
    WHERE p.Id = ? AND p.ManifestId = ? AND p.IsDeleted = 0
      AND i.IsDeleted = 0 AND i.DeletedAt IS NULL`;

  /**
   * Get passkeys by item ID.
   */
  public static readonly GET_BY_ITEM_ID = `
    SELECT
      p.Id,
      p.ItemId,
      p.ManifestId,
      p.RpId,
      p.UserHandle,
      p.PublicKey,
      p.PrivateKey,
      p.DisplayName,
      p.PrfKey,
      p.AdditionalData,
      p.CreatedAt,
      p.UpdatedAt,
      p.IsDeleted
    FROM Passkeys p
    WHERE p.ItemId = ? AND p.ManifestId = ? AND p.IsDeleted = 0
    ORDER BY p.CreatedAt DESC`;

  /**
   * Insert a new passkey into the manifest of the item it hangs off.
   */
  public static readonly INSERT = `
    INSERT INTO Passkeys (
      Id, ItemId, ManifestId, RpId, UserHandle, PublicKey, PrivateKey,
      PrfKey, DisplayName, AdditionalData, CreatedAt, UpdatedAt, IsDeleted
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  /**
   * Soft delete passkey by ID.
   */
  public static readonly SOFT_DELETE = `
    UPDATE Passkeys
    SET IsDeleted = 1,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;
}
