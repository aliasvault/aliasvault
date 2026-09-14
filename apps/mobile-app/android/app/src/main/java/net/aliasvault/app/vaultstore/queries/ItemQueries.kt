package net.aliasvault.app.vaultstore.queries

/**
 * SQL query constants for the item reads the autofill service needs.
 * Every join and lookup is keyed by (ManifestId, Id) because the same id can exist in more than one manifest.
 */
object ItemQueries {
    /**
     * Base SELECT for items with common fields.
     * Includes a LEFT JOIN to the item's logo row and scoped subqueries for HasPasskey/HasAttachment/HasTotp.
     */
    const val BASE_SELECT = """
        SELECT DISTINCT
          i.Id,
          i.ManifestId,
          i.Name,
          i.ItemType,
          i.FolderId,
          l.FileData as Logo,
          CASE WHEN EXISTS (
            SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.ManifestId = i.ManifestId AND pk.IsDeleted = 0
          ) THEN 1 ELSE 0 END as HasPasskey,
          CASE WHEN EXISTS (
            SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.ManifestId = i.ManifestId AND att.IsDeleted = 0
          ) THEN 1 ELSE 0 END as HasAttachment,
          CASE WHEN EXISTS (
            SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.ManifestId = i.ManifestId AND tc.IsDeleted = 0
          ) THEN 1 ELSE 0 END as HasTotp,
          i.CreatedAt,
          i.UpdatedAt,
          i.ArchivedAt
        FROM Items i
        LEFT JOIN Logos l ON i.LogoId = l.Id AND l.ManifestId = i.ManifestId
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
     * Get field values for multiple items, matched on the whole (ManifestId, ItemId) key.
     * @param itemCount Number of items (one `(?, ?)` pair each, bound as manifestId, itemId, ...)
     * @return Query with placeholders
     */
    fun getFieldValuesForItems(itemCount: Int): String {
        val placeholders = Array(itemCount) { "(?, ?)" }.joinToString(", ")
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
            WHERE (fv.ManifestId, fv.ItemId) IN (VALUES $placeholders)
              AND fv.IsDeleted = 0
            ORDER BY fv.ItemId, fv.Weight
        """.trimIndent()
    }

    /**
     * Get an item's TOTP codes. Binds (itemId, manifestId).
     */
    const val GET_TOTP_CODES_FOR_ITEM = """
        SELECT Id, Name, SecretKey, Algorithm, Digits, Period, ItemId
        FROM TotpCodes
        WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0
    """

    /**
     * Get the database version from the __EFMigrationsHistory table.
     */
    const val GET_DATABASE_VERSION = """
        SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1
    """

    /**
     * Get folder data for building folder paths, one tree per manifest.
     */
    const val GET_ALL_FOLDERS = """
        SELECT Id, ManifestId, Name, ParentFolderId FROM Folders WHERE IsDeleted = 0
    """
}
