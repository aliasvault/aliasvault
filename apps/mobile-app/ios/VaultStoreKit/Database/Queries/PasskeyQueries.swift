import Foundation

/// SQL query constants for Passkey operations.
/// Centralizes all passkey-related queries to avoid duplication.
public struct PasskeyQueries {
    /// Base SELECT for passkeys with common fields.
    public static let baseSelect = """
        SELECT
          p.Id,
          p.ItemId,
          p.RpId,
          p.UserHandle,
          p.PublicKey,
          p.PrivateKey,
          p.PrfKey,
          p.DisplayName,
          p.CreatedAt,
          p.UpdatedAt,
          p.IsDeleted
        FROM Passkeys p
        """

    /// Get a passkey by its ID (credential ID).
    public static let getById = """
        \(baseSelect)
        WHERE p.Id = ? AND p.IsDeleted = 0
        """

    /// Get all passkeys for an item.
    public static let getByItemId = """
        \(baseSelect)
        WHERE p.ItemId = ? AND p.IsDeleted = 0
        ORDER BY p.CreatedAt DESC
        """

    /// Get all passkeys for a relying party (rpId).
    public static let getByRpId = """
        \(baseSelect)
        WHERE p.RpId = ? AND p.IsDeleted = 0
        ORDER BY p.CreatedAt DESC
        """

    /// Get passkeys with item info for a specific rpId.
    /// Joins with Items and FieldValues to get display info.
    public static let getWithItemInfoByRpId = """
        SELECT
          p.Id,
          p.ItemId,
          p.RpId,
          p.UserHandle,
          p.PublicKey,
          p.PrivateKey,
          p.PrfKey,
          p.DisplayName,
          p.CreatedAt,
          p.UpdatedAt,
          p.IsDeleted,
          i.Name as ServiceName,
          fv.Value as Username
        FROM Passkeys p
        INNER JOIN Items i ON p.ItemId = i.Id
        LEFT JOIN FieldValues fv ON fv.ItemId = i.Id AND fv.FieldKey = 'login.username' AND fv.IsDeleted = 0
        WHERE p.RpId = ? AND p.IsDeleted = 0 AND i.IsDeleted = 0
        ORDER BY p.CreatedAt DESC
        """

    /// Insert a new passkey.
    public static let insert = """
        INSERT INTO Passkeys (Id, ItemId, RpId, UserHandle, PublicKey, PrivateKey, PrfKey, DisplayName, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

    /// Soft delete a passkey.
    public static let softDelete = """
        UPDATE Passkeys
        SET IsDeleted = 1,
            UpdatedAt = ?
        WHERE Id = ?
        """

    /// Update passkey display name.
    public static let updateDisplayName = """
        UPDATE Passkeys
        SET DisplayName = ?,
            UpdatedAt = ?
        WHERE Id = ? AND IsDeleted = 0
        """

    /// Get Items that match an rpId but don't have a passkey yet.
    /// Used for finding existing credentials that could have a passkey added to them.
    /// Note: The public API now uses getAllItemsWithoutPasskey + Rust credential matcher for consistent cross-platform matching.
    /// This query is kept for potential fallback scenarios.
    public static let getItemsWithoutPasskeyForRpId = """
        SELECT i.Id, i.Name, i.CreatedAt, i.UpdatedAt,
               fv_url.Value as Url,
               fv_username.Value as Username,
               fv_password.Value as Password
        FROM Items i
        INNER JOIN FieldValues fv_url ON fv_url.ItemId = i.Id
            AND fv_url.FieldKey = 'login.url'
            AND fv_url.IsDeleted = 0
        LEFT JOIN FieldValues fv_username ON fv_username.ItemId = i.Id
            AND fv_username.FieldKey = 'login.username'
            AND fv_username.IsDeleted = 0
        LEFT JOIN FieldValues fv_password ON fv_password.ItemId = i.Id
            AND fv_password.FieldKey = 'login.password'
            AND fv_password.IsDeleted = 0
        WHERE i.IsDeleted = 0
            AND i.DeletedAt IS NULL
            AND i.ItemType = 'Login'
            AND (LOWER(fv_url.Value) LIKE ? OR LOWER(fv_url.Value) LIKE ?)
            AND NOT EXISTS (
                SELECT 1 FROM Passkeys p
                WHERE p.ItemId = i.Id AND p.IsDeleted = 0
            )
        ORDER BY i.UpdatedAt DESC
        """

    /// Get ALL Login items that don't have a passkey yet (no URL filtering).
    /// Used with Rust credential matcher for intelligent filtering.
    /// Returns items with their URLs aggregated using GROUP_CONCAT for multi-URL support.
    public static let getAllItemsWithoutPasskey = """
        SELECT i.Id, i.Name, i.CreatedAt, i.UpdatedAt,
               GROUP_CONCAT(DISTINCT fv_url.Value) as Urls,
               fv_username.Value as Username,
               fv_password.Value as Password
        FROM Items i
        LEFT JOIN FieldValues fv_url ON fv_url.ItemId = i.Id
            AND fv_url.FieldKey = 'login.url'
            AND fv_url.IsDeleted = 0
        LEFT JOIN FieldValues fv_username ON fv_username.ItemId = i.Id
            AND fv_username.FieldKey = 'login.username'
            AND fv_username.IsDeleted = 0
        LEFT JOIN FieldValues fv_password ON fv_password.ItemId = i.Id
            AND fv_password.FieldKey = 'login.password'
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
        """
}

/// SQL query constants for Logo operations used during passkey/item creation.
public struct LogoQueries {
    /// Insert a new logo.
    public static let insert = """
        INSERT INTO Logos (Id, Source, FileData, MimeType, FetchedAt, CreatedAt, UpdatedAt, IsDeleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """

    /// Update logo file data.
    public static let updateFileData = """
        UPDATE Logos
        SET FileData = ?,
            UpdatedAt = ?
        WHERE Id = ?
        """
}
