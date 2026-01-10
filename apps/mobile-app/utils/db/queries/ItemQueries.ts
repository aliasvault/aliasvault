/**
 * SQL query constants for Item operations.
 * Centralizes all item-related queries to avoid duplication.
 * Mirrors the browser extension implementation.
 */
export class ItemQueries {
  /**
   * Base SELECT for items with common fields.
   * Includes LEFT JOIN to Logos and Folders, and subqueries for HasPasskey/HasAttachment/HasTotp.
   */
  public static readonly BASE_SELECT = `
    SELECT DISTINCT
      i.Id,
      i.Name,
      i.ItemType,
      i.FolderId,
      f.Name as FolderPath,
      l.FileData as Logo,
      CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
      CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
      CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
      i.CreatedAt,
      i.UpdatedAt
    FROM Items i
    LEFT JOIN Logos l ON i.LogoId = l.Id
    LEFT JOIN Folders f ON i.FolderId = f.Id`;

  /**
   * Get all active items (not deleted, not in trash).
   */
  public static readonly GET_ALL_ACTIVE = `
    ${ItemQueries.BASE_SELECT}
    WHERE i.IsDeleted = 0 AND i.DeletedAt IS NULL
    ORDER BY i.CreatedAt DESC`;

  /**
   * Get a single item by ID.
   */
  public static readonly GET_BY_ID = `
    SELECT
      i.Id,
      i.Name,
      i.ItemType,
      i.FolderId,
      f.Name as FolderPath,
      l.FileData as Logo,
      CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
      CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
      CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
      i.CreatedAt,
      i.UpdatedAt
    FROM Items i
    LEFT JOIN Logos l ON i.LogoId = l.Id
    LEFT JOIN Folders f ON i.FolderId = f.Id
    WHERE i.Id = ? AND i.IsDeleted = 0`;

  /**
   * Get field values for multiple items.
   * @param itemCount - Number of items (for placeholder generation)
   * @returns Query with placeholders
   */
  public static getFieldValuesForItems(itemCount: number): string {
    const placeholders = Array(itemCount).fill('?').join(',');
    return `
      SELECT
        fv.ItemId,
        fv.FieldKey,
        fv.FieldDefinitionId,
        fd.Label as CustomLabel,
        fd.FieldType as CustomFieldType,
        fd.IsHidden as CustomIsHidden,
        fd.EnableHistory as CustomEnableHistory,
        fv.Value,
        fv.Weight as DisplayOrder
      FROM FieldValues fv
      LEFT JOIN FieldDefinitions fd ON fv.FieldDefinitionId = fd.Id
      WHERE fv.ItemId IN (${placeholders})
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
    LEFT JOIN FieldDefinitions fd ON fv.FieldDefinitionId = fd.Id
    WHERE fv.ItemId = ? AND fv.IsDeleted = 0
    ORDER BY fv.Weight`;

  /**
   * Get all unique email addresses from field values.
   */
  public static readonly GET_ALL_EMAIL_ADDRESSES = `
    SELECT DISTINCT fv.Value as Email
    FROM FieldValues fv
    INNER JOIN Items i ON fv.ItemId = i.Id
    WHERE fv.FieldKey = ?
      AND fv.Value IS NOT NULL
      AND fv.Value != ''
      AND fv.IsDeleted = 0
      AND i.IsDeleted = 0
      AND i.DeletedAt IS NULL`;

  /**
   * Get an item by email address (case-insensitive).
   * Used to find items associated with a specific email address.
   */
  public static readonly GET_BY_EMAIL = `
    SELECT DISTINCT
      i.Id,
      i.Name,
      i.ItemType,
      i.FolderId,
      f.Name as FolderPath,
      l.FileData as Logo,
      CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
      CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
      CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
      i.CreatedAt,
      i.UpdatedAt
    FROM Items i
    LEFT JOIN Logos l ON i.LogoId = l.Id
    LEFT JOIN Folders f ON i.FolderId = f.Id
    INNER JOIN FieldValues fv ON fv.ItemId = i.Id
    WHERE LOWER(fv.Value) = LOWER(?)
      AND fv.FieldKey = ?
      AND fv.IsDeleted = 0
      AND i.IsDeleted = 0
      AND i.DeletedAt IS NULL
    LIMIT 1`;

  /**
   * Get all recently deleted items (in trash).
   */
  public static readonly GET_RECENTLY_DELETED = `
    SELECT DISTINCT
      i.Id,
      i.Name,
      i.ItemType,
      i.FolderId,
      f.Name as FolderPath,
      l.FileData as Logo,
      CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
      CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
      CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
      i.CreatedAt,
      i.UpdatedAt,
      i.DeletedAt
    FROM Items i
    LEFT JOIN Logos l ON i.LogoId = l.Id
    LEFT JOIN Folders f ON i.FolderId = f.Id
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
   * Insert a new item.
   */
  public static readonly INSERT_ITEM = `
    INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  /**
   * Update an existing item.
   */
  public static readonly UPDATE_ITEM = `
    UPDATE Items
    SET Name = ?,
        ItemType = ?,
        FolderId = ?,
        LogoId = COALESCE(?, LogoId),
        UpdatedAt = ?
    WHERE Id = ?`;

  /**
   * Move item to trash (set DeletedAt).
   */
  public static readonly TRASH_ITEM = `
    UPDATE Items
    SET DeletedAt = ?,
        UpdatedAt = ?
    WHERE Id = ? AND IsDeleted = 0`;

  /**
   * Restore item from trash (clear DeletedAt).
   */
  public static readonly RESTORE_ITEM = `
    UPDATE Items
    SET DeletedAt = NULL,
        UpdatedAt = ?
    WHERE Id = ? AND IsDeleted = 0 AND DeletedAt IS NOT NULL`;

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
    WHERE Id = ?`;
}

/**
 * SQL query constants for FieldValue operations.
 */
export class FieldValueQueries {
  /**
   * Get existing field values for an item.
   */
  public static readonly GET_EXISTING_FOR_ITEM = `
    SELECT Id, FieldKey, FieldDefinitionId, Value
    FROM FieldValues
    WHERE ItemId = ? AND IsDeleted = 0`;

  /**
   * Insert a new field value.
   */
  public static readonly INSERT = `
    INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  /**
   * Update an existing field value.
   */
  public static readonly UPDATE = `
    UPDATE FieldValues
    SET Value = ?,
        Weight = ?,
        UpdatedAt = ?
    WHERE Id = ?`;

  /**
   * Soft delete a field value.
   */
  public static readonly SOFT_DELETE = `
    UPDATE FieldValues
    SET IsDeleted = 1,
        UpdatedAt = ?
    WHERE Id = ?`;
}

/**
 * SQL query constants for FieldDefinition operations.
 */
export class FieldDefinitionQueries {
  /**
   * Check if a field definition exists.
   */
  public static readonly EXISTS = `
    SELECT Id FROM FieldDefinitions WHERE Id = ?`;

  /**
   * Check if a field definition exists and is not deleted.
   */
  public static readonly EXISTS_ACTIVE = `
    SELECT Id FROM FieldDefinitions WHERE Id = ? AND IsDeleted = 0`;

  /**
   * Insert a new field definition.
   */
  public static readonly INSERT = `
    INSERT INTO FieldDefinitions (Id, FieldType, Label, IsMultiValue, IsHidden, EnableHistory, Weight, ApplicableToTypes, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
    WHERE Id = ?`;
}

/**
 * SQL query constants for FieldHistory operations.
 */
export class FieldHistoryQueries {
  /**
   * Insert a history record.
   */
  public static readonly INSERT = `
    INSERT INTO FieldHistories (Id, ItemId, FieldDefinitionId, FieldKey, ValueSnapshot, ChangedAt, CreatedAt, UpdatedAt, IsDeleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
    WHERE ItemId = ? AND FieldKey = ? AND IsDeleted = 0
    ORDER BY ChangedAt DESC
    LIMIT ?`;

  /**
   * Get field values for history comparison (before update).
   */
  public static readonly GET_FOR_HISTORY = `
    SELECT FieldKey, Value
    FROM FieldValues
    WHERE ItemId = ? AND IsDeleted = 0`;

  /**
   * Get all history records for pruning.
   */
  public static readonly GET_FOR_PRUNING = `
    SELECT Id, ChangedAt
    FROM FieldHistories
    WHERE ItemId = ? AND FieldKey = ? AND IsDeleted = 0
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
      WHERE Id IN (${placeholders})`;
  }
}
