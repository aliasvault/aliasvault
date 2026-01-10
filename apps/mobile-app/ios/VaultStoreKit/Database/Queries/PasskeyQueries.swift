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
