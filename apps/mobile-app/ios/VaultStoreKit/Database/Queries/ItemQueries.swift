import Foundation

/// SQL query constants for Item operations.
public struct ItemQueries {
    /// Base SELECT for items with common fields.
    /// Includes LEFT JOIN to Logos and subqueries for HasPasskey/HasAttachment/HasTotp.
    public static let baseSelect = """
        SELECT DISTINCT
          i.Id,
          i.ManifestId,
          i.Name,
          i.ItemType,
          i.FolderId,
          l.FileData as Logo,
          CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.ManifestId = i.ManifestId AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
          CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.ManifestId = i.ManifestId AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
          CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.ManifestId = i.ManifestId AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
          i.CreatedAt,
          i.UpdatedAt,
          i.ArchivedAt
        FROM Items i
        LEFT JOIN Logos l ON i.LogoId = l.Id AND l.ManifestId = i.ManifestId
        """

    /// Get all active items (not deleted, not in trash, not archived). This is what autofill reads.
    public static let getAllActive = """
        \(baseSelect)
        WHERE i.IsDeleted = 0 AND i.DeletedAt IS NULL AND i.ArchivedAt IS NULL
        ORDER BY i.CreatedAt DESC
        """

    /// Get field values for multiple items, matched on the whole item key.
    /// - Parameter itemCount: Number of items (for placeholder generation)
    /// - Returns: Query with one (?, ?) placeholder pair per item, bound as [manifestId, itemId, ...]
    public static func getFieldValuesForItems(_ itemCount: Int) -> String {
        let placeholders = Array(repeating: "(?, ?)", count: itemCount).joined(separator: ", ")
        return """
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
            WHERE (fv.ManifestId, fv.ItemId) IN (VALUES \(placeholders))
              AND fv.IsDeleted = 0
            ORDER BY fv.ItemId, fv.Weight
            """
    }

    /// All live folders, for building folder paths one manifest's tree at a time.
    public static let getAllFolders = """
        SELECT Id, ManifestId, Name, ParentFolderId FROM Folders WHERE IsDeleted = 0
        """

    /// Insert a new item, bound as [id, name, itemType, logoId, folderId, now, now, 0, manifestId].
    public static let insertItem = """
        INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, CreatedAt, UpdatedAt, IsDeleted, ManifestId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

    /// Bump an item's UpdatedAt so a child-row change is picked up by sync.
    public static let touchItem = """
        UPDATE Items SET UpdatedAt = ? WHERE Id = ? AND ManifestId = ?
        """
}

/// SQL query constants for FieldValue operations.
public struct FieldValueQueries {
    /// Insert a new field value, bound as [id, itemId, fieldDefinitionId, fieldKey, value, weight, now, now, 0, manifestId].
    public static let insert = """
        INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted, ManifestId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

    /// The Weight a system field's values are written with: the field's DefaultDisplayOrder from
    /// core/models `SystemFieldRegistry.ts`, which is what the TypeScript writers store.
    public static func defaultWeight(forFieldKey fieldKey: String) -> Int {
        switch fieldKey {
        case "login.url":
            return 5
        case "login.username":
            return 15
        default:
            return 0
        }
    }
}
