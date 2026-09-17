import Foundation

/// SQL query constants for Passkey operations.
public struct PasskeyQueries {
    /// The passkey columns every SELECT projects.
    private static let columns = """
          p.Id,
          p.ItemId,
          p.ManifestId,
          p.RpId,
          p.UserHandle,
          p.PublicKey,
          p.PrivateKey,
          p.PrfKey,
          p.DisplayName,
          p.AdditionalData,
          p.CreatedAt,
          p.UpdatedAt,
          p.IsDeleted
        """

    /// Base SELECT for passkeys without item information.
    public static let baseSelect = """
        SELECT
        \(columns)
        FROM Passkeys p
        """

    /// Base SELECT for passkeys joined with their item, which must be live (not deleted, not in trash).
    public static let baseSelectWithItemCheck = """
        SELECT
        \(columns)
        FROM Passkeys p
        INNER JOIN Items i ON p.ItemId = i.Id AND i.ManifestId = p.ManifestId AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
        """

    /// Get a passkey by its ID (credential ID).
    public static let getById = """
        \(baseSelectWithItemCheck)
        WHERE p.Id = ? AND p.IsDeleted = 0
        """

    /// Get one passkey inside one manifest, bound as [passkeyId, manifestId].
    public static let getByIdInManifest = """
        \(baseSelectWithItemCheck)
        WHERE p.Id = ? AND p.ManifestId = ? AND p.IsDeleted = 0
        """

    /// Get all passkeys for one item, bound as [itemId, manifestId].
    public static let getByItemId = """
        \(baseSelect)
        WHERE p.ItemId = ? AND p.ManifestId = ? AND p.IsDeleted = 0
        ORDER BY p.CreatedAt DESC
        """

    /// Get all passkeys for a relying party (rpId).
    public static let getByRpId = """
        \(baseSelectWithItemCheck)
        WHERE p.RpId = ? AND p.IsDeleted = 0
        ORDER BY p.CreatedAt DESC
        """

    /// Get passkeys with item info for a specific rpId.
    public static let getWithItemInfoByRpId = """
        SELECT
        \(columns),
          i.Name as ServiceName,
          (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = 'login.username' AND fv.IsDeleted = 0 LIMIT 1) as Username,
          (SELECT fv.Value FROM FieldValues fv WHERE fv.ItemId = i.Id AND fv.ManifestId = i.ManifestId AND fv.FieldKey = 'login.email' AND fv.IsDeleted = 0 LIMIT 1) as Email
        FROM Passkeys p
        INNER JOIN Items i ON p.ItemId = i.Id AND i.ManifestId = p.ManifestId
        WHERE p.RpId = ? AND p.IsDeleted = 0 AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
        ORDER BY p.CreatedAt DESC
        """

    /// Insert a new passkey, stamped with the manifest of the item it hangs off (bound third, after the item id).
    public static let insert = """
        INSERT INTO Passkeys (Id, ItemId, ManifestId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey, DisplayName, AdditionalData, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

    /// Soft delete a passkey, bound as [now, passkeyId, manifestId].
    public static let softDelete = """
        UPDATE Passkeys
        SET IsDeleted = 1,
            UpdatedAt = ?
        WHERE Id = ? AND ManifestId = ?
        """

    /// Update passkey display name, bound as [displayName, now, passkeyId, manifestId].
    public static let updateDisplayName = """
        UPDATE Passkeys
        SET DisplayName = ?,
            UpdatedAt = ?
        WHERE Id = ? AND ManifestId = ? AND IsDeleted = 0
        """

    /// Get ALL active Login items that don't have a passkey yet (no URL filtering).
    /// Used with Rust credential matcher for intelligent filtering.
    /// Returns items with their URLs aggregated using GROUP_CONCAT for multi-URL support.
    public static let getAllItemsWithoutPasskey = """
        SELECT i.Id, i.ManifestId, i.Name, i.CreatedAt, i.UpdatedAt,
               GROUP_CONCAT(DISTINCT fv_url.Value) as Urls,
               fv_username.Value as Username,
               fv_email.Value as Email,
               fv_password.Value as Password
        FROM Items i
        LEFT JOIN FieldValues fv_url ON fv_url.ItemId = i.Id AND fv_url.ManifestId = i.ManifestId
            AND fv_url.FieldKey = 'login.url'
            AND fv_url.IsDeleted = 0
        LEFT JOIN FieldValues fv_username ON fv_username.ItemId = i.Id AND fv_username.ManifestId = i.ManifestId
            AND fv_username.FieldKey = 'login.username'
            AND fv_username.IsDeleted = 0
        LEFT JOIN FieldValues fv_email ON fv_email.ItemId = i.Id AND fv_email.ManifestId = i.ManifestId
            AND fv_email.FieldKey = 'login.email'
            AND fv_email.IsDeleted = 0
        LEFT JOIN FieldValues fv_password ON fv_password.ItemId = i.Id AND fv_password.ManifestId = i.ManifestId
            AND fv_password.FieldKey = 'login.password'
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
        """
}

/// SQL query constants for Logo operations used during passkey/item creation.
/// Mirrors core/client `LogoQueries.ts`.
public struct LogoQueries {
    /// The logo of a given kind and key within one manifest, bound as [manifestId, kind, source].
    public static let getIdForKey = """
        SELECT Id FROM Logos
        WHERE ManifestId = ? AND Kind = ? AND Source = ? AND IsDeleted = 0
        LIMIT 1
        """

    /// The best row to copy from when a manifest needs a logo it does not have but the vault does, bound as [kind, source].
    public static let getBestForKey = """
        SELECT FileData, MimeType, Name FROM Logos
        WHERE Kind = ? AND Source = ? AND IsDeleted = 0
        ORDER BY (FileData IS NOT NULL AND LENGTH(FileData) > 0) DESC, UpdatedAt DESC
        LIMIT 1
        """

    /// The kind and key of an existing logo.
    public static let getById = """
        SELECT Id, Kind, Source, Name FROM Logos
        WHERE Id = ? AND IsDeleted = 0
        LIMIT 1
        """

    /// Insert or update a logo, bound as [id, kind, source, manifestId, fileData, mimeType, name, now, now].
    public static let upsert = """
        INSERT INTO Logos (Id, Kind, Source, ManifestId, FileData, MimeType, Name, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(ManifestId, Id) DO UPDATE SET
          FileData = excluded.FileData,
          MimeType = excluded.MimeType,
          Name = COALESCE(excluded.Name, Logos.Name),
          UpdatedAt = excluded.UpdatedAt,
          IsDeleted = 0
        """

    /// Get the logo ID of one item, bound as [itemId, manifestId].
    public static let getLogoIdFromItem = """
        SELECT LogoId FROM Items WHERE Id = ? AND ManifestId = ?
        """

    /// Point an item at a logo, bound as [logoId, now, itemId, manifestId].
    public static let updateItemLogoId = """
        UPDATE Items SET LogoId = ?, UpdatedAt = ? WHERE Id = ? AND ManifestId = ?
        """
}
