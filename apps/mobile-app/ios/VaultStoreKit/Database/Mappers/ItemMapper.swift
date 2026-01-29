import Foundation
import SQLite
import VaultModels
import VaultUtils

/// Raw item row from database query.
public struct ItemRow {
    public let id: String
    public let name: String?
    public let itemType: String
    public let folderId: String?
    public let folderPath: String?
    public let logo: Data?
    public let hasPasskey: Bool
    public let hasAttachment: Bool
    public let hasTotp: Bool
    public let createdAt: String
    public let updatedAt: String
    public let deletedAt: String?

    /// Initialize from a database row dictionary.
    public init?(from row: [String: Any]) {
        guard let id = row["Id"] as? String,
              let itemType = row["ItemType"] as? String,
              let createdAt = row["CreatedAt"] as? String,
              let updatedAt = row["UpdatedAt"] as? String else {
            return nil
        }

        self.id = id
        self.name = row["Name"] as? String
        self.itemType = itemType
        self.folderId = row["FolderId"] as? String
        self.folderPath = row["FolderPath"] as? String

        // Handle logo data - can be base64 string or Blob
        if let logoBase64 = row["Logo"] as? String {
            self.logo = Data(base64Encoded: logoBase64)
        } else if let logoBlob = row["Logo"] as? SQLite.Blob {
            self.logo = Data(logoBlob.bytes)
        } else {
            self.logo = nil
        }

        self.hasPasskey = (row["HasPasskey"] as? Int64 ?? 0) == 1
        self.hasAttachment = (row["HasAttachment"] as? Int64 ?? 0) == 1
        self.hasTotp = (row["HasTotp"] as? Int64 ?? 0) == 1
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = row["DeletedAt"] as? String
    }
}

/// Raw tag row from database query.
public struct TagRow {
    public let itemId: String
    public let id: String
    public let name: String
    public let color: String?

    /// Initialize from a database row dictionary.
    public init?(from row: [String: Any]) {
        guard let itemId = row["ItemId"] as? String,
              let id = row["Id"] as? String,
              let name = row["Name"] as? String else {
            return nil
        }

        self.itemId = itemId
        self.id = id
        self.name = name
        self.color = row["Color"] as? String
    }
}

/// Tag reference for single item queries (without ItemId).
public struct SingleItemTagRow {
    public let id: String
    public let name: String
    public let color: String?

    /// Initialize from a database row dictionary.
    public init?(from row: [String: Any]) {
        guard let id = row["Id"] as? String,
              let name = row["Name"] as? String else {
            return nil
        }

        self.id = id
        self.name = name
        self.color = row["Color"] as? String
    }
}

/// Mapper class for converting database rows to Item objects.
public struct ItemMapper {
    /// Map a single database row to an Item object.
    /// - Parameters:
    ///   - row: Raw item row from database
    ///   - fields: Processed fields for this item
    /// - Returns: Item object
    public static func mapRow(_ row: ItemRow, fields: [ItemField] = []) -> Item? {
        guard let createdAt = DateHelpers.parseDateString(row.createdAt),
              let updatedAt = DateHelpers.parseDateString(row.updatedAt) else {
            return nil
        }

        return Item(
            id: UUID(uuidString: row.id) ?? UUID(),
            name: row.name,
            itemType: row.itemType,
            logo: row.logo,
            folderId: row.folderId.flatMap { UUID(uuidString: $0) },
            folderPath: row.folderPath,
            fields: fields,
            hasPasskey: row.hasPasskey,
            hasAttachment: row.hasAttachment,
            hasTotp: row.hasTotp,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }

    /// Map multiple database rows to Item objects with their fields.
    /// - Parameters:
    ///   - rows: Raw item rows from database
    ///   - fieldsByItem: Dictionary of ItemId to array of fields
    /// - Returns: Array of Item objects
    public static func mapRows(
        _ rows: [ItemRow],
        fieldsByItem: [String: [ItemField]]
    ) -> [Item] {
        return rows.compactMap { row in
            let fields = fieldsByItem[row.id] ?? []
            return mapRow(row, fields: fields)
        }
    }

    /// Map a single item row for recently deleted items (includes DeletedAt).
    /// - Parameters:
    ///   - row: Raw item row with DeletedAt
    ///   - fields: Processed fields for this item
    /// - Returns: Item object (deletedAt stored as extension or separate property if needed)
    public static func mapDeletedItemRow(_ row: ItemRow, fields: [ItemField] = []) -> Item? {
        return mapRow(row, fields: fields)
    }
}
