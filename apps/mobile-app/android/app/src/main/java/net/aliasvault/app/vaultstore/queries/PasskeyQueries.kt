package net.aliasvault.app.vaultstore.queries

/**
 * SQL query constants for Passkey operations.
 * Centralizes all passkey-related queries to avoid duplication.
 */
object PasskeyQueries {
    /**
     * Base SELECT for passkeys with common fields.
     */
    const val BASE_SELECT = """
        SELECT Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
               DisplayName, CreatedAt, UpdatedAt, IsDeleted
        FROM Passkeys
    """

    /**
     * Get a passkey by its credential ID.
     */
    const val GET_BY_CREDENTIAL_ID = """
        $BASE_SELECT
        WHERE Id = ? AND IsDeleted = 0
        LIMIT 1
    """

    /**
     * Get all passkeys for an item.
     */
    const val GET_BY_ITEM_ID = """
        $BASE_SELECT
        WHERE ItemId = ? AND IsDeleted = 0
        ORDER BY CreatedAt DESC
    """

    /**
     * Get all passkeys for a relying party (rpId).
     */
    const val GET_BY_RP_ID = """
        $BASE_SELECT
        WHERE RpId = ? AND IsDeleted = 0
        ORDER BY CreatedAt DESC
    """

    /**
     * Get a passkey by its ID.
     */
    const val GET_BY_ID = """
        $BASE_SELECT
        WHERE Id = ? AND IsDeleted = 0
        LIMIT 1
    """

    /**
     * Insert a new passkey.
     */
    const val INSERT = """
        INSERT INTO Passkeys (Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey,
                             DisplayName, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    /**
     * Get passkeys with item info for a specific rpId.
     * Joins with Items and FieldValues to get display info.
     */
    val GET_WITH_CREDENTIAL_INFO = """
        SELECT p.Id, p.ItemId, p.RpId, p.UserHandle, p.PublicKey, p.PrivateKey, p.PrfKey,
               p.DisplayName, p.CreatedAt, p.UpdatedAt, p.IsDeleted,
               i.Name,
               fv_username.Value as Username,
               fv_email.Value as Email
        FROM Passkeys p
        INNER JOIN Items i ON p.ItemId = i.Id
        LEFT JOIN FieldValues fv_username ON fv_username.ItemId = i.Id
            AND fv_username.FieldKey = ?
            AND fv_username.IsDeleted = 0
        LEFT JOIN FieldValues fv_email ON fv_email.ItemId = i.Id
            AND fv_email.FieldKey = ?
            AND fv_email.IsDeleted = 0
        WHERE p.RpId = ? AND p.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
        ORDER BY p.CreatedAt DESC
    """.trimIndent()

    /**
     * Get ALL Login items that don't have a passkey yet (no URL filtering).
     * Used with RustCredentialMatcher for intelligent, cross-platform consistent filtering.
     */
    val GET_ALL_ITEMS_WITHOUT_PASSKEY = """
        SELECT i.Id, i.Name, i.CreatedAt, i.UpdatedAt,
               GROUP_CONCAT(DISTINCT fv_url.Value) as Urls,
               fv_username.Value as Username,
               fv_email.Value as Email,
               fv_password.Value as Password
        FROM Items i
        LEFT JOIN FieldValues fv_url ON fv_url.ItemId = i.Id
            AND fv_url.FieldKey = ?
            AND fv_url.IsDeleted = 0
        LEFT JOIN FieldValues fv_username ON fv_username.ItemId = i.Id
            AND fv_username.FieldKey = ?
            AND fv_username.IsDeleted = 0
        LEFT JOIN FieldValues fv_email ON fv_email.ItemId = i.Id
            AND fv_email.FieldKey = ?
            AND fv_email.IsDeleted = 0
        LEFT JOIN FieldValues fv_password ON fv_password.ItemId = i.Id
            AND fv_password.FieldKey = ?
            AND fv_password.IsDeleted = 0
        WHERE i.IsDeleted = 0
            AND i.DeletedAt IS NULL
            AND i.ItemType = 'Login'
            AND NOT EXISTS (
                SELECT 1 FROM Passkeys p
                WHERE p.ItemId = i.Id AND p.IsDeleted = 0
            )
        GROUP BY i.Id
        ORDER BY i.UpdatedAt DESC
    """.trimIndent()

    /**
     * Get all passkeys with their associated items in a single query.
     */
    val GET_ALL_WITH_ITEMS = """
        SELECT
            p.Id, p.ItemId, p.RpId, p.UserHandle, p.PublicKey, p.PrivateKey, p.PrfKey,
            p.DisplayName, p.CreatedAt as PasskeyCreatedAt, p.UpdatedAt as PasskeyUpdatedAt, p.IsDeleted as PasskeyIsDeleted,
            i.Id as ItemId, i.Name, i.CreatedAt as ItemCreatedAt, i.UpdatedAt as ItemUpdatedAt,
            fv_username.Value as Username,
            fv_email.Value as Email
        FROM Passkeys p
        INNER JOIN Items i ON p.ItemId = i.Id
        LEFT JOIN FieldValues fv_username ON fv_username.ItemId = i.Id
            AND fv_username.FieldKey = ?
            AND fv_username.IsDeleted = 0
        LEFT JOIN FieldValues fv_email ON fv_email.ItemId = i.Id
            AND fv_email.FieldKey = ?
            AND fv_email.IsDeleted = 0
        WHERE p.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
        ORDER BY p.CreatedAt DESC
    """.trimIndent()

    /**
     * Create an Item record for passkey registration.
     */
    const val CREATE_ITEM = """
        INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, CreatedAt, UpdatedAt, IsDeleted, DeletedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    /**
     * Insert a URL field value.
     */
    const val INSERT_FIELD_VALUE = """
        INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    /**
     * Update item's UpdatedAt timestamp.
     */
    const val UPDATE_ITEM_TIMESTAMP = """
        UPDATE Items SET UpdatedAt = ? WHERE Id = ?
    """

    /**
     * Get logo ID from an item.
     */
    const val GET_LOGO_ID_FROM_ITEM = """
        SELECT LogoId FROM Items WHERE Id = ?
    """
}

/**
 * SQL query constants for Logo operations used during passkey/item creation.
 */
object LogoQueries {
    /**
     * Insert a new logo.
     */
    const val INSERT = """
        INSERT INTO Logos (Id, Source, FileData, MimeType, FetchedAt, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """

    /**
     * Update logo file data.
     */
    const val UPDATE_FILE_DATA = """
        UPDATE Logos
        SET FileData = ?,
            UpdatedAt = ?
        WHERE Id = ?
    """

    /**
     * Get logo by source.
     */
    const val GET_BY_SOURCE = """
        SELECT Id, IsDeleted FROM Logos WHERE Source = ? LIMIT 1
    """

    /**
     * Restore a soft-deleted logo.
     */
    const val RESTORE = """
        UPDATE Logos SET IsDeleted = 0, UpdatedAt = ? WHERE Id = ?
    """

    /**
     * Update item logo ID.
     */
    const val UPDATE_ITEM_LOGO_ID = """
        UPDATE Items SET LogoId = ?, UpdatedAt = ? WHERE Id = ?
    """
}
