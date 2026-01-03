import Foundation

/// SQL query constants for Item operations.
/// Centralizes all item-related queries to avoid duplication.
/// Mirrors the React Native implementation.
public struct ItemQueries {
    /// Base SELECT for items with common fields.
    /// Includes LEFT JOIN to Logos and Folders, and subqueries for HasPasskey/HasAttachment/HasTotp.
    public static let baseSelect = """
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
        """

    /// Get all active items (not deleted, not in trash).
    public static let getAllActive = """
        \(baseSelect)
        WHERE i.IsDeleted = 0 AND i.DeletedAt IS NULL
        ORDER BY i.CreatedAt DESC
        """

    /// Get a single item by ID.
    public static let getById = """
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
        WHERE i.Id = ? AND i.IsDeleted = 0
        """

    /// Get field values for multiple items.
    /// - Parameter itemCount: Number of items (for placeholder generation)
    /// - Returns: Query with placeholders
    public static func getFieldValuesForItems(_ itemCount: Int) -> String {
        let placeholders = Array(repeating: "?", count: itemCount).joined(separator: ",")
        return """
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
            WHERE fv.ItemId IN (\(placeholders))
              AND fv.IsDeleted = 0
            ORDER BY fv.ItemId, fv.Weight
            """
    }

    /// Get field values for a single item.
    public static let getFieldValuesForItem = """
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
        ORDER BY fv.Weight
        """

    /// Get all unique email addresses from field values.
    public static let getAllEmailAddresses = """
        SELECT DISTINCT fv.Value as Email
        FROM FieldValues fv
        INNER JOIN Items i ON fv.ItemId = i.Id
        WHERE fv.FieldKey = ?
          AND fv.Value IS NOT NULL
          AND fv.Value != ''
          AND fv.IsDeleted = 0
          AND i.IsDeleted = 0
          AND i.DeletedAt IS NULL
        """

    /// Get all recently deleted items (in trash).
    public static let getRecentlyDeleted = """
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
        ORDER BY i.DeletedAt DESC
        """

    /// Count of recently deleted items.
    public static let countRecentlyDeleted = """
        SELECT COUNT(*) as count
        FROM Items
        WHERE IsDeleted = 0 AND DeletedAt IS NOT NULL
        """

    /// Insert a new item.
    public static let insertItem = """
        INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """

    /// Update an existing item.
    public static let updateItem = """
        UPDATE Items
        SET Name = ?,
            ItemType = ?,
            FolderId = ?,
            LogoId = COALESCE(?, LogoId),
            UpdatedAt = ?
        WHERE Id = ?
        """

    /// Move item to trash (set DeletedAt).
    public static let trashItem = """
        UPDATE Items
        SET DeletedAt = ?,
            UpdatedAt = ?
        WHERE Id = ? AND IsDeleted = 0
        """

    /// Restore item from trash (clear DeletedAt).
    public static let restoreItem = """
        UPDATE Items
        SET DeletedAt = NULL,
            UpdatedAt = ?
        WHERE Id = ? AND IsDeleted = 0 AND DeletedAt IS NOT NULL
        """

    /// Convert item to tombstone for permanent deletion.
    public static let tombstoneItem = """
        UPDATE Items
        SET IsDeleted = 1,
            Name = NULL,
            LogoId = NULL,
            FolderId = NULL,
            UpdatedAt = ?
        WHERE Id = ?
        """
}

/// SQL query constants for FieldValue operations.
public struct FieldValueQueries {
    /// Get existing field values for an item.
    public static let getExistingForItem = """
        SELECT Id, FieldKey, FieldDefinitionId, Value
        FROM FieldValues
        WHERE ItemId = ? AND IsDeleted = 0
        """

    /// Insert a new field value.
    public static let insert = """
        INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

    /// Update an existing field value.
    public static let update = """
        UPDATE FieldValues
        SET Value = ?,
            Weight = ?,
            UpdatedAt = ?
        WHERE Id = ?
        """

    /// Soft delete a field value.
    public static let softDelete = """
        UPDATE FieldValues
        SET IsDeleted = 1,
            UpdatedAt = ?
        WHERE Id = ?
        """
}

/// SQL query constants for Tag operations.
public struct TagQueries {
    /// Get tags for multiple items.
    /// - Parameter itemCount: Number of items (for placeholder generation)
    /// - Returns: Query with placeholders
    public static func getTagsForItems(_ itemCount: Int) -> String {
        let placeholders = Array(repeating: "?", count: itemCount).joined(separator: ",")
        return """
            SELECT it.ItemId, t.Id, t.Name, t.Color
            FROM ItemTags it
            INNER JOIN Tags t ON it.TagId = t.Id
            WHERE it.ItemId IN (\(placeholders))
              AND it.IsDeleted = 0
              AND t.IsDeleted = 0
            ORDER BY t.DisplayOrder
            """
    }

    /// Get tags for a single item.
    public static let getTagsForItem = """
        SELECT t.Id, t.Name, t.Color
        FROM ItemTags it
        INNER JOIN Tags t ON it.TagId = t.Id
        WHERE it.ItemId = ?
          AND it.IsDeleted = 0
          AND t.IsDeleted = 0
        ORDER BY t.DisplayOrder
        """
}
