package net.aliasvault.app.vaultstore.queries

/**
 * SQL query constants for Item operations.
 * Centralizes all item-related queries to avoid duplication.
 * Mirrors the browser extension and React Native implementation.
 */
object ItemQueries {
    /**
     * Base SELECT for items with common fields.
     * Includes LEFT JOIN to Logos and subqueries for HasPasskey/HasAttachment/HasTotp.
     */
    const val BASE_SELECT = """
        SELECT DISTINCT
          i.Id,
          i.Name,
          i.ItemType,
          i.FolderId,
          l.FileData as Logo,
          CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
          CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
          CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
          i.CreatedAt,
          i.UpdatedAt,
          i.ArchivedAt
        FROM Items i
        LEFT JOIN Logos l ON i.LogoId = l.Id
    """

    /**
     * Get all active items (not deleted, not in trash, not archived).
     */
    const val GET_ALL_ACTIVE = """
        $BASE_SELECT
        WHERE i.IsDeleted = 0 AND i.DeletedAt IS NULL AND i.ArchivedAt IS NULL
        ORDER BY i.CreatedAt DESC
    """

    /**
     * Get all archived items. Trashed items are excluded: an item that is both archived and
     * trashed belongs in "Recently Deleted", which is the more urgent of the two states.
     */
    const val GET_ARCHIVED = """
        $BASE_SELECT
        WHERE i.IsDeleted = 0 AND i.DeletedAt IS NULL AND i.ArchivedAt IS NOT NULL
        ORDER BY i.ArchivedAt DESC
    """

    /**
     * Count of archived items.
     */
    const val COUNT_ARCHIVED = """
        SELECT COUNT(*) as count
        FROM Items
        WHERE IsDeleted = 0 AND DeletedAt IS NULL AND ArchivedAt IS NOT NULL
    """

    /**
     * Get a single item by ID.
     */
    const val GET_BY_ID = """
        $BASE_SELECT
        WHERE i.Id = ? AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
    """

    /**
     * Get field values for multiple items.
     * @param itemCount Number of items (for placeholder generation)
     * @return Query with placeholders
     */
    fun getFieldValuesForItems(itemCount: Int): String {
        val placeholders = Array(itemCount) { "?" }.joinToString(",")
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
            WHERE fv.ItemId IN ($placeholders)
              AND fv.IsDeleted = 0
            ORDER BY fv.ItemId, fv.Weight
        """.trimIndent()
    }

    /**
     * Get field values for a single item.
     */
    const val GET_FIELD_VALUES_FOR_ITEM = """
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

    /**
     * Get all unique email addresses from field values.
     */
    const val GET_ALL_EMAIL_ADDRESSES = """
        SELECT DISTINCT fv.Value as Email
        FROM FieldValues fv
        INNER JOIN Items i ON fv.ItemId = i.Id
        WHERE fv.FieldKey = ?
          AND fv.IsDeleted = 0
          AND i.IsDeleted = 0
          AND i.DeletedAt IS NULL
    """

    /**
     * Get all recently deleted items (in trash).
     */
    const val GET_RECENTLY_DELETED = """
        SELECT DISTINCT
          i.Id,
          i.Name,
          i.ItemType,
          i.FolderId,
          l.FileData as Logo,
          CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
          CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
          CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
          i.CreatedAt,
          i.UpdatedAt,
          i.DeletedAt
        FROM Items i
        LEFT JOIN Logos l ON i.LogoId = l.Id
        WHERE i.IsDeleted = 0 AND i.DeletedAt IS NOT NULL
        ORDER BY i.DeletedAt DESC
    """

    /**
     * Count of recently deleted items.
     */
    const val COUNT_RECENTLY_DELETED = """
        SELECT COUNT(*) as count
        FROM Items
        WHERE IsDeleted = 0 AND DeletedAt IS NOT NULL
    """

    /**
     * Get the database version from the __EFMigrationsHistory table.
     */
    const val GET_DATABASE_VERSION = """
        SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1
    """

    /**
     * Move item to trash (set DeletedAt).
     */
    const val TRASH_ITEM = """
        UPDATE Items SET DeletedAt = ?, UpdatedAt = ? WHERE Id = ?
    """

    /**
     * Restore item from trash (clear DeletedAt).
     */
    const val RESTORE_ITEM = """
        UPDATE Items SET DeletedAt = NULL, UpdatedAt = ? WHERE Id = ?
    """

    /**
     * Archive an item (set ArchivedAt).
     */
    const val ARCHIVE_ITEM = """
        UPDATE Items SET ArchivedAt = ?, UpdatedAt = ? WHERE Id = ? AND IsDeleted = 0 AND ArchivedAt IS NULL
    """

    /**
     * Unarchive an item (clear ArchivedAt).
     */
    const val UNARCHIVE_ITEM = """
        UPDATE Items SET ArchivedAt = NULL, UpdatedAt = ? WHERE Id = ? AND IsDeleted = 0 AND ArchivedAt IS NOT NULL
    """

    /**
     * Convert item to tombstone for permanent deletion.
     */
    const val TOMBSTONE_ITEM = """
        UPDATE Items
        SET Name = NULL,
            ItemType = NULL,
            LogoId = NULL,
            FolderId = NULL,
            DeletedAt = NULL,
            ArchivedAt = NULL,
            IsDeleted = 1,
            UpdatedAt = ?
        WHERE Id = ?
    """

    /**
     * Get folder data for building folder paths.
     */
    const val GET_ALL_FOLDERS = """
        SELECT Id, Name, ParentFolderId FROM Folders WHERE IsDeleted = 0
    """
}
