import { BaseQueries } from './BaseQueries';

/**
 * SQL query constants for Item operations.
 * Centralizes all item-related queries to avoid duplication.
 */
export class ItemQueries {
  /**
   * Base SELECT for items with common fields.
   * Includes LEFT JOIN to the item's logo row, which carries the image bytes for a favicon or an
   * uploaded image, and the catalog key for a built-in logo (which has no bytes). Folder paths are
   * computed in the repository layer.
   */
  public static readonly BASE_SELECT = `
    SELECT DISTINCT
      i.Id,
      i.ManifestId,
      i.Name,
      i.ItemType,
      i.FolderId,
      l.FileData as Logo,
      l.Id as LogoId,
      l.Kind as LogoKind,
      l.Source as LogoSource,
      l.Name as LogoName,
      CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.ManifestId = i.ManifestId AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
      CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.ManifestId = i.ManifestId AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
      CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.ManifestId = i.ManifestId AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
      i.CreatedAt,
      i.UpdatedAt
    FROM Items i
    LEFT JOIN Logos l ON i.LogoId = l.Id AND l.ManifestId = i.ManifestId`;

  /**
   * Get all active items (not deleted, not in trash).
   */
  public static readonly GET_ALL_ACTIVE = `
    ${ItemQueries.BASE_SELECT}
    WHERE i.IsDeleted = 0 AND i.DeletedAt IS NULL
    ORDER BY i.CreatedAt DESC`;

  /**
   * Get a single item by its manifest-qualified key: an id alone does not identify a row, since the
   * same id can exist in two or more manifests.
   */
  public static readonly GET_BY_ID = `
    SELECT
      i.Id,
      i.ManifestId,
      i.Name,
      i.ItemType,
      i.FolderId,
      l.FileData as Logo,
      l.Id as LogoId,
      l.Kind as LogoKind,
      l.Source as LogoSource,
      l.Name as LogoName,
      CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.ManifestId = i.ManifestId AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
      CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.ManifestId = i.ManifestId AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
      CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.ManifestId = i.ManifestId AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
      i.CreatedAt,
      i.UpdatedAt
    FROM Items i
    LEFT JOIN Logos l ON i.LogoId = l.Id AND l.ManifestId = i.ManifestId
    WHERE i.Id = ? AND i.ManifestId = ? AND i.IsDeleted = 0`;

  /**
   * Get all recently deleted items (in trash).
   */
  public static readonly GET_RECENTLY_DELETED = `
    SELECT
      i.Id,
      i.ManifestId,
      i.Name,
      i.ItemType,
      i.FolderId,
      l.FileData as Logo,
      l.Id as LogoId,
      l.Kind as LogoKind,
      l.Source as LogoSource,
      l.Name as LogoName,
      CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.ManifestId = i.ManifestId AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
      CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.ManifestId = i.ManifestId AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
      CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.ManifestId = i.ManifestId AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
      i.CreatedAt,
      i.UpdatedAt,
      i.DeletedAt
    FROM Items i
    LEFT JOIN Logos l ON i.LogoId = l.Id AND l.ManifestId = i.ManifestId
    WHERE i.IsDeleted = 0 AND i.DeletedAt IS NOT NULL
    ORDER BY i.DeletedAt DESC`;

  /**
   * Count of recently deleted items.
   */
  public static readonly COUNT_RECENTLY_DELETED = `
    SELECT COUNT(*) as count
    FROM Items
    WHERE IsDeleted = 0 AND DeletedAt IS NOT NULL`;

  /**
   * Get field values for multiple items, matched on the whole item key.
   *
   * The caller passes `(ManifestId, Id)` pairs rather than bare ids: items are keyed by both, so two
   * manifests may hold an item with the same Id and matching on the Id alone would hand each one the
   * other's fields.
   * @param itemCount - Number of items (for placeholder generation)
   * @returns Query with one (?, ?) placeholder pair per item, bound as [manifestId, itemId, ...]
   */
  public static getFieldValuesForItems(itemCount: number): string {
    const placeholders = ItemQueries.itemKeyPlaceholders(itemCount);
    return `
      SELECT
        fv.ItemId,
        fv.ManifestId,
        fv.FieldKey,
        fv.FieldDefinitionId,
        fd.Label as CustomLabel,
        fd.FieldType as CustomFieldType,
        fd.IsHidden as CustomIsHidden,
        fd.EnableHistory as CustomEnableHistory,
        fv.Value,
        fv.Weight as DisplayOrder
      FROM FieldValues fv
      LEFT JOIN FieldDefinitions fd ON fd.ManifestId = fv.ManifestId AND fd.Id = fv.FieldDefinitionId
      WHERE (fv.ManifestId, fv.ItemId) IN (VALUES ${placeholders})
        AND fv.IsDeleted = 0
      ORDER BY fv.ItemId, fv.Weight`;
  }

  /**
   * Get field values for a single item.
   */
  public static readonly GET_FIELD_VALUES_FOR_ITEM = `
    SELECT
      fv.FieldKey,
      fv.FieldDefinitionId,
      fd.Label as CustomLabel,
      fd.FieldType as CustomFieldType,
      fd.IsHidden as CustomIsHidden,
      fd.EnableHistory as CustomEnableHistory,
      fv.Value,
      fv.Weight as DisplayOrder
    FROM FieldValues fv
    LEFT JOIN FieldDefinitions fd ON fd.ManifestId = fv.ManifestId AND fd.Id = fv.FieldDefinitionId
    WHERE fv.ItemId = ? AND fv.ManifestId = ? AND fv.IsDeleted = 0
    ORDER BY fv.Weight`;

  /**
   * Get tags for multiple items, matched on the whole item key (see {@link getFieldValuesForItems}).
   * @param itemCount - Number of items (for placeholder generation)
   * @returns Query with one (?, ?) placeholder pair per item, bound as [manifestId, itemId, ...]
   */
  public static getTagsForItems(itemCount: number): string {
    const placeholders = ItemQueries.itemKeyPlaceholders(itemCount);
    return `
      SELECT
        it.ItemId,
        it.ManifestId,
        t.Id,
        t.Name,
        t.Color
      FROM ItemTags it
      INNER JOIN Tags t ON t.ManifestId = it.ManifestId AND t.Id = it.TagId
      WHERE (it.ManifestId, it.ItemId) IN (VALUES ${placeholders})
        AND it.IsDeleted = 0
        AND t.IsDeleted = 0
      ORDER BY t.DisplayOrder, t.Name`;
  }

  private static itemKeyPlaceholders(itemCount: number): string {
    return Array(itemCount).fill('(?, ?)').join(', ');
  }

  /**
   * Get tags for a single item.
   */
  public static readonly GET_TAGS_FOR_ITEM = `
    SELECT
      t.Id,
      t.Name,
      t.Color
    FROM ItemTags it
    INNER JOIN Tags t ON t.ManifestId = it.ManifestId AND t.Id = it.TagId
    WHERE it.ItemId = ? AND it.ManifestId = ? AND it.IsDeleted = 0 AND t.IsDeleted = 0
    ORDER BY t.DisplayOrder, t.Name`;

  /**
   * Insert a new item, stamped with the manifest of the folder it is placed in.
   */
  public static readonly INSERT_ITEM = `
    INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, ManifestId, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?, ${BaseQueries.MANIFEST_OF_FOLDER}, ?, ?, ?)`;

  /**
   * Update an existing item (preserves LogoId if null is passed).
   */
  public static readonly UPDATE_ITEM = `
    UPDATE Items
    SET Name = ?,
        ItemType = ?,
        FolderId = ?,
        ManifestId = ${BaseQueries.MANIFEST_OF_FOLDER},
        LogoId = COALESCE(?, LogoId),
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Update an existing item with explicit LogoId setting (can clear LogoId to null).
   */
  public static readonly UPDATE_ITEM_WITH_LOGO = `
    UPDATE Items
    SET Name = ?,
        ItemType = ?,
        FolderId = ?,
        ManifestId = ${BaseQueries.MANIFEST_OF_FOLDER},
        LogoId = ?,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Move item to trash (set DeletedAt).
   */
  public static readonly TRASH_ITEM = `
    UPDATE Items
    SET DeletedAt = ?,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ? AND IsDeleted = 0`;

  /**
   * Restore item from trash (clear DeletedAt).
   */
  public static readonly RESTORE_ITEM = `
    UPDATE Items
    SET DeletedAt = NULL,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ? AND IsDeleted = 0 AND DeletedAt IS NOT NULL`;

  /**
   * Convert item to tombstone for permanent deletion.
   */
  public static readonly TOMBSTONE_ITEM = `
    UPDATE Items
    SET IsDeleted = 1,
        Name = NULL,
        LogoId = NULL,
        FolderId = NULL,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Get all unique email addresses from field values.
   */
  public static readonly GET_ALL_EMAIL_ADDRESSES = `
    SELECT DISTINCT fv.Value as Email
    FROM FieldValues fv
    INNER JOIN Items i ON fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId
    WHERE fv.FieldKey = ?
      AND fv.Value IS NOT NULL
      AND fv.Value != ''
      AND fv.IsDeleted = 0
      AND i.IsDeleted = 0
      AND i.DeletedAt IS NULL`;

  /**
   * Look up an item (id + name) by an email address stored in any of its login email fields.
   */
  public static readonly GET_ITEM_BY_EMAIL = `
    SELECT i.Id as Id, i.Name as Name
    FROM FieldValues fv
    INNER JOIN Items i ON fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId
    WHERE fv.FieldKey = ?
      AND fv.Value = ?
      AND fv.IsDeleted = 0
      AND i.IsDeleted = 0
      AND i.DeletedAt IS NULL
    LIMIT 1`;

  /**
   * Get item-level fields for change detection during updates.
   */
  public static readonly GET_ITEM_FIELDS = `
    SELECT Name, ItemType, FolderId, LogoId
    FROM Items
    WHERE Id = ? AND ManifestId = ?`;
}

/**
 * SQL query constants for FieldValue operations.
 */
export class FieldValueQueries {
  /**
   * Get existing field values for an item.
   */
  public static readonly GET_EXISTING_FOR_ITEM = `
    SELECT Id, FieldKey, FieldDefinitionId, Value, Weight
    FROM FieldValues
    WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0`;

  /**
   * Insert a new field value, stamped with the manifest of the item it hangs off.
   */
  public static readonly INSERT = `
    INSERT INTO FieldValues (Id, ItemId, ManifestId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ${BaseQueries.MANIFEST_OF_ITEM}, ?, ?, ?, ?, ?, ?, ?)`;

  /**
   * Update an existing field value.
   */
  public static readonly UPDATE = `
    UPDATE FieldValues
    SET Value = ?,
        Weight = ?,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Soft delete a field value.
   */
  public static readonly SOFT_DELETE = `
    UPDATE FieldValues
    SET IsDeleted = 1,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Get existing field values for history tracking.
   */
  public static readonly GET_FOR_HISTORY = `
    SELECT FieldKey, Value
    FROM FieldValues
    WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0 AND FieldKey IS NOT NULL`;
}

/**
 * SQL query constants for FieldDefinition operations.
 */
export class FieldDefinitionQueries {
  /**
   * Check if a field definition exists in the item's manifest. Binds [definitionId, itemId].
   */
  public static readonly EXISTS = `
    SELECT Id FROM FieldDefinitions WHERE Id = ? AND ManifestId = ${BaseQueries.MANIFEST_OF_ITEM}`;

  /**
   * Check if a field definition exists in the item's manifest and is not deleted. Binds [definitionId, itemId].
   */
  public static readonly EXISTS_ACTIVE = `
    SELECT Id FROM FieldDefinitions WHERE Id = ? AND ManifestId = ${BaseQueries.MANIFEST_OF_ITEM} AND IsDeleted = 0`;

  /**
   * Insert a new field definition into the item's manifest. Binds [definitionId, itemId, ...].
   */
  public static readonly INSERT = `
    INSERT INTO FieldDefinitions (Id, ManifestId, FieldType, Label, IsMultiValue, IsHidden, EnableHistory, Weight, ApplicableToTypes, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ${BaseQueries.MANIFEST_OF_ITEM}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  /**
   * Update an existing field definition.
   */
  public static readonly UPDATE = `
    UPDATE FieldDefinitions
    SET Label = ?,
        FieldType = ?,
        IsHidden = ?,
        Weight = ?,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ${BaseQueries.MANIFEST_OF_ITEM}`;
}

/**
 * SQL query constants for FieldHistory operations.
 */
export class FieldHistoryQueries {
  /**
   * Insert a history record, stamped with the manifest of the item it hangs off.
   */
  public static readonly INSERT = `
    INSERT INTO FieldHistories (Id, ItemId, ManifestId, FieldDefinitionId, FieldKey, ValueSnapshot, ChangedAt, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ${BaseQueries.MANIFEST_OF_ITEM}, ?, ?, ?, ?, ?, ?, ?)`;

  /**
   * Get history records for a field.
   */
  public static readonly GET_FOR_FIELD = `
    SELECT
      Id,
      ItemId,
      FieldKey,
      ValueSnapshot,
      ChangedAt,
      CreatedAt,
      UpdatedAt
    FROM FieldHistories
    WHERE ItemId = ? AND ManifestId = ? AND FieldKey = ? AND IsDeleted = 0
    ORDER BY ChangedAt DESC
    LIMIT ?`;

  /**
   * Get all history records for pruning.
   */
  public static readonly GET_FOR_PRUNING = `
    SELECT Id, ChangedAt
    FROM FieldHistories
    WHERE ItemId = ? AND ManifestId = ? AND FieldKey = ? AND IsDeleted = 0
    ORDER BY ChangedAt DESC`;

  /**
   * Soft delete old history records.
   * @param count - Number of records to delete
   * @returns Query with placeholders
   */
  public static softDeleteOld(count: number): string {
    const placeholders = Array(count).fill('?').join(',');
    return `
      UPDATE FieldHistories
      SET IsDeleted = 1, UpdatedAt = ?
      WHERE ManifestId = ? AND Id IN (${placeholders})`;
  }

  /**
   * Soft delete a single history record.
   */
  public static readonly SOFT_DELETE = `
    UPDATE FieldHistories
    SET IsDeleted = 1, UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;
}

/**
 * SQL query constants for TotpCode operations.
 */
export class TotpCodeQueries {
  /**
   * Get an item's TOTP codes. Scoped by manifest as well as item: an id alone does not name one item,
   * so a bare `ItemId` match would pull in a same-id item's codes from another manifest.
   */
  public static readonly GET_BY_ITEM_ID = `
    SELECT Id, Name, SecretKey, Algorithm, Digits, Period, ItemId
    FROM TotpCodes
    WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0`;

  /**
   * Insert a new TOTP code, stamped with the manifest of the item it hangs off.
   */
  public static readonly INSERT = `
    INSERT INTO TotpCodes (Id, Name, SecretKey, Algorithm, Digits, Period, ItemId, ManifestId, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ${BaseQueries.MANIFEST_OF_ITEM}, ?, ?, ?)`;

  /**
   * Update an existing TOTP code.
   */
  public static readonly UPDATE = `
    UPDATE TotpCodes
    SET Name = ?,
        SecretKey = ?,
        Algorithm = ?,
        Digits = ?,
        Period = ?,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Soft delete a TOTP code.
   */
  public static readonly SOFT_DELETE = `
    UPDATE TotpCodes
    SET IsDeleted = 1,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;
}

/**
 * SQL query constants for Attachment operations.
 */
export class AttachmentQueries {
  /**
   * Get an item's attachments. Scoped by manifest as well as item, for the same reason as
   * {@link TotpCodeQueries.GET_BY_ITEM_ID}.
   */
  public static readonly GET_BY_ITEM_ID = `
    SELECT
      Id,
      Filename,
      Blob,
      ItemId,
      CreatedAt,
      UpdatedAt,
      IsDeleted
    FROM Attachments
    WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0`;

  /**
   * Insert a new attachment, stamped with the manifest of the item it hangs off.
   */
  public static readonly INSERT = `
    INSERT INTO Attachments (Id, Filename, Blob, ItemId, ManifestId, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ${BaseQueries.MANIFEST_OF_ITEM}, ?, ?, ?)`;

  /**
   * Soft delete an attachment. Also zeroes the Blob bytes so storage is reclaimed
   * immediately while the row remains as a tombstone for LWW sync.
   */
  public static readonly SOFT_DELETE = `
    UPDATE Attachments
    SET IsDeleted = 1,
        Blob = X'',
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;
}
