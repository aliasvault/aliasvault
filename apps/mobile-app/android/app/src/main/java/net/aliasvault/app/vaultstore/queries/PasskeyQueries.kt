package net.aliasvault.app.vaultstore.queries

import net.aliasvault.app.vaultstore.models.FieldKey

/**
 * SQL query constants for Passkey operations.
 */
object PasskeyQueries {
    /**
     * Base SELECT for passkeys without item information.
     */
    const val BASE_SELECT = """
        SELECT p.Id, p.ItemId, p.ManifestId, p.RpId, p.UserHandle, p.PublicKey, p.PrivateKey, p.PrfKey,
               p.DisplayName, p.AdditionalData, p.CreatedAt, p.UpdatedAt, p.IsDeleted
        FROM Passkeys p
    """

    /**
     * Base SELECT for passkeys joined to their live (not trashed, not tombstoned) item.
     */
    const val BASE_SELECT_WITH_ITEM = """
        SELECT p.Id, p.ItemId, p.ManifestId, p.RpId, p.UserHandle, p.PublicKey, p.PrivateKey, p.PrfKey,
               p.DisplayName, p.AdditionalData, p.CreatedAt, p.UpdatedAt, p.IsDeleted,
               i.Name as ServiceName,
               i.CreatedAt as ItemCreatedAt,
               i.UpdatedAt as ItemUpdatedAt,
               (SELECT fv.Value FROM FieldValues fv
                WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = '${FieldKey.LOGIN_USERNAME}' AND fv.IsDeleted = 0
                LIMIT 1) as Username,
               (SELECT fv.Value FROM FieldValues fv
                WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = '${FieldKey.LOGIN_EMAIL}' AND fv.IsDeleted = 0
                LIMIT 1) as Email
        FROM Passkeys p
        INNER JOIN Items i ON p.ItemId = i.Id AND i.ManifestId = p.ManifestId
    """

    /**
     * Get a passkey by its ID (which is also the WebAuthn credential ID), only while its item is live.
     */
    const val GET_BY_ID = """
        $BASE_SELECT_WITH_ITEM
        WHERE p.Id = ? AND p.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
        LIMIT 1
    """

    /**
     * Get all passkeys for an item. Binds (itemId, manifestId).
     */
    const val GET_BY_ITEM_ID = """
        $BASE_SELECT
        WHERE p.ItemId = ? AND p.ManifestId = ? AND p.IsDeleted = 0
        ORDER BY p.CreatedAt DESC
    """

    /**
     * Get all passkeys for a relying party (rpId) whose item is live.
     */
    const val GET_BY_RP_ID = """
        $BASE_SELECT_WITH_ITEM
        WHERE p.RpId = ? AND p.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
        ORDER BY p.CreatedAt DESC
    """

    /**
     * Get every passkey whose item is live, with the item's display info.
     */
    const val GET_ALL_WITH_ITEMS = """
        $BASE_SELECT_WITH_ITEM
        WHERE p.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
        ORDER BY p.CreatedAt DESC
    """

    /**
     * Insert a new passkey, stamped with the manifest of the item it hangs off (bound third, after the item id).
     */
    const val INSERT = """
        INSERT INTO Passkeys (Id, ItemId, ManifestId, RpId, UserHandle, PublicKey, PrivateKey,
                              PrfKey, DisplayName, AdditionalData, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    /**
     * Soft delete a passkey. Binds (now, id, manifestId).
     */
    const val SOFT_DELETE = """
        UPDATE Passkeys SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ? AND ManifestId = ?
    """

    /**
     * Get ALL active Login items that don't have a passkey yet (no URL filtering).
     * Used with RustItemMatcher for intelligent, cross-platform consistent filtering.
     */
    val GET_ALL_ITEMS_WITHOUT_PASSKEY = """
        SELECT i.Id, i.ManifestId, i.Name, i.CreatedAt, i.UpdatedAt,
               GROUP_CONCAT(DISTINCT fv_url.Value) as Urls,
               fv_username.Value as Username,
               fv_email.Value as Email,
               fv_password.Value as Password
        FROM Items i
        LEFT JOIN FieldValues fv_url ON fv_url.ItemId = i.Id AND fv_url.ManifestId = i.ManifestId
            AND fv_url.FieldKey = ?
            AND fv_url.IsDeleted = 0
        LEFT JOIN FieldValues fv_username ON fv_username.ItemId = i.Id AND fv_username.ManifestId = i.ManifestId
            AND fv_username.FieldKey = ?
            AND fv_username.IsDeleted = 0
        LEFT JOIN FieldValues fv_email ON fv_email.ItemId = i.Id AND fv_email.ManifestId = i.ManifestId
            AND fv_email.FieldKey = ?
            AND fv_email.IsDeleted = 0
        LEFT JOIN FieldValues fv_password ON fv_password.ItemId = i.Id AND fv_password.ManifestId = i.ManifestId
            AND fv_password.FieldKey = ?
            AND fv_password.IsDeleted = 0
        WHERE i.IsDeleted = 0
            AND i.DeletedAt IS NULL
            AND i.ArchivedAt IS NULL
            AND i.ItemType = 'Login'
            AND NOT EXISTS (
                SELECT 1 FROM Passkeys p
                WHERE p.ItemId = i.Id AND p.ManifestId = i.ManifestId AND p.IsDeleted = 0
            )
        GROUP BY i.ManifestId, i.Id
        ORDER BY i.UpdatedAt DESC
    """.trimIndent()

    /**
     * Create an Item record for passkey registration. Binds (id, name, itemType, logoId, folderId, now, now, 0, null, manifestId).
     */
    const val CREATE_ITEM = """
        INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, CreatedAt, UpdatedAt, IsDeleted, DeletedAt, ManifestId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    /**
     * Insert a field value. Binds (id, itemId, fieldDefinitionId, fieldKey, value, weight, now, now, 0, manifestId).
     */
    const val INSERT_FIELD_VALUE = """
        INSERT INTO FieldValues (Id, ItemId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted, ManifestId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    /**
     * Update an item's UpdatedAt timestamp. Binds (now, id, manifestId).
     */
    const val UPDATE_ITEM_TIMESTAMP = """
        UPDATE Items SET UpdatedAt = ? WHERE Id = ? AND ManifestId = ?
    """

    /**
     * Get the logo ID of an item. Binds (id, manifestId).
     */
    const val GET_LOGO_ID_FROM_ITEM = """
        SELECT LogoId FROM Items WHERE Id = ? AND ManifestId = ?
    """
}

/**
 * SQL query constants for the Logos rows the passkey flows read and write.
 * Mirrors core/client LogoQueries.ts.
 */
object LogoQueries {
    /**
     * The id of the logo with this kind and key inside one manifest. Binds (manifestId, kind, source).
     */
    const val GET_ID_FOR_KEY = """
        SELECT Id FROM Logos
        WHERE ManifestId = ? AND Kind = ? AND Source = ? AND IsDeleted = 0
        LIMIT 1
    """

    /**
     * The best row to copy from when a manifest needs a logo it does not have but the vault does. Binds (kind, source).
     */
    const val GET_BEST_FOR_KEY = """
        SELECT FileData, MimeType, Name FROM Logos
        WHERE Kind = ? AND Source = ? AND IsDeleted = 0
        ORDER BY (FileData IS NOT NULL AND LENGTH(FileData) > 0) DESC, UpdatedAt DESC
        LIMIT 1
    """

    /**
     * The kind and key of an existing logo. Binds (id, manifestId).
     */
    const val GET_BY_ID = """
        SELECT Id, Kind, Source, Name FROM Logos
        WHERE Id = ? AND ManifestId = ? AND IsDeleted = 0
        LIMIT 1
    """

    /**
     * Insert or refresh a logo. Binds (id, kind, source, manifestId, fileData, mimeType, name, now, now).
     */
    const val UPSERT = """
        INSERT INTO Logos (Id, Kind, Source, ManifestId, FileData, MimeType, Name, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(ManifestId, Id) DO UPDATE SET
          FileData = excluded.FileData,
          MimeType = excluded.MimeType,
          Name = COALESCE(excluded.Name, Logos.Name),
          UpdatedAt = excluded.UpdatedAt,
          IsDeleted = 0
    """

    /**
     * Point an item at a logo. Binds (logoId, now, itemId, manifestId).
     */
    const val UPDATE_ITEM_LOGO_ID = """
        UPDATE Items SET LogoId = ?, UpdatedAt = ? WHERE Id = ? AND ManifestId = ?
    """
}
