import { FieldKey } from '@/utils/dist/core/models/vault';

import { BaseQueries } from './BaseQueries';

/**
 * SQL query constants for Passkey operations.
 * Centralizes all passkey-related queries to avoid duplication.
 */
export class PasskeyQueries {
  /**
   * Base SELECT for passkeys with item information.
   */
  public static readonly BASE_SELECT_WITH_ITEM = `
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
      (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = '${FieldKey.LoginUsername}' AND fv.IsDeleted = 0 LIMIT 1) as Username
    FROM Passkeys p
    INNER JOIN Items i ON p.ItemId = i.Id AND i.ManifestId = p.ManifestId`;

  /**
   * Base SELECT for passkeys without item information.
   */
  public static readonly BASE_SELECT = `
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
    FROM Passkeys p`;

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
      (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = '${FieldKey.LoginUsername}' AND fv.IsDeleted = 0 LIMIT 1) as Username
    FROM Passkeys p
    INNER JOIN Items i ON p.ItemId = i.Id AND i.ManifestId = p.ManifestId
    WHERE p.RpId = ? AND p.IsDeleted = 0
      AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
    ORDER BY p.CreatedAt DESC`;

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
      (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = '${FieldKey.LoginUsername}' AND fv.IsDeleted = 0 LIMIT 1) as Username
    FROM Passkeys p
    INNER JOIN Items i ON p.ItemId = i.Id AND i.ManifestId = p.ManifestId
    WHERE p.Id = ? AND p.IsDeleted = 0
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
   * Insert a new passkey, stamped with the manifest of the item it hangs off. Binds the item id
   * twice — once for the column, once for {@link BaseQueries.MANIFEST_OF_ITEM}.
   */
  public static readonly INSERT = `
    INSERT INTO Passkeys (
      Id, ItemId, ManifestId, RpId, UserHandle, PublicKey, PrivateKey,
      PrfKey, DisplayName, AdditionalData, CreatedAt, UpdatedAt, IsDeleted
    )
    VALUES (?, ?, ${BaseQueries.MANIFEST_OF_ITEM}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  /**
   * Update passkey display name.
   */
  public static readonly UPDATE_DISPLAY_NAME = `
    UPDATE Passkeys
    SET DisplayName = ?,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Soft delete passkey by ID.
   */
  public static readonly SOFT_DELETE = `
    UPDATE Passkeys
    SET IsDeleted = 1,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Soft delete passkeys by item ID.
   */
  public static readonly SOFT_DELETE_BY_ITEM = `
    UPDATE Passkeys
    SET IsDeleted = 1,
        UpdatedAt = ?
    WHERE ItemId = ? AND ManifestId = ?`;
}
