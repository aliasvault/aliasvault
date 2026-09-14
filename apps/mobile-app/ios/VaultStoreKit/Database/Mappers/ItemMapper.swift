import Foundation
import VaultModels
import VaultUtils

/// Raw item row from database query.
public struct ItemRow {
    public let id: String
    public let manifestId: String
    public let name: String?
    public let itemType: String
    public let folderId: String?
    public let logo: Data?
    public let hasPasskey: Bool
    public let hasAttachment: Bool
    public let hasTotp: Bool
    public let createdAt: String
    public let updatedAt: String
    public let deletedAt: String?
    public let archivedAt: String?

    /// Initialize from a database row dictionary.
    public init?(from row: [String: Any]) {
        guard let id = row["Id"] as? String,
              let manifestId = row["ManifestId"] as? String,
              let itemType = row["ItemType"] as? String,
              let createdAt = row["CreatedAt"] as? String,
              let updatedAt = row["UpdatedAt"] as? String else {
            return nil
        }

        self.id = id
        self.manifestId = manifestId
        self.name = row["Name"] as? String
        self.itemType = itemType
        self.folderId = row["FolderId"] as? String

        // BLOB columns arrive as base64 text
        if let logoBase64 = row["Logo"] as? String {
            self.logo = Data(base64Encoded: logoBase64)
        } else {
            self.logo = nil
        }

        self.hasPasskey = (row["HasPasskey"] as? Int64 ?? 0) == 1
        self.hasAttachment = (row["HasAttachment"] as? Int64 ?? 0) == 1
        self.hasTotp = (row["HasTotp"] as? Int64 ?? 0) == 1
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = row["DeletedAt"] as? String
        self.archivedAt = row["ArchivedAt"] as? String
    }

    /// The key this item's child rows and folder path are grouped under (see `scopedKey`).
    internal var scopedItemKey: String {
        return scopedKey(manifestId: manifestId, id: id)
    }
}

/// Mapper class for converting database rows to Item objects.
public struct ItemMapper {
    /// Map a single database row to an Item object.
    /// - Parameters:
    ///   - row: Raw item row from database
    ///   - fields: Processed fields for this item
    ///   - folderPath: Computed folder path array (optional)
    /// - Returns: Item object
    public static func mapRow(_ row: ItemRow, fields: [ItemField] = [], folderPath: [String]? = nil) -> Item? {
        guard let createdAt = DateHelpers.parseDateString(row.createdAt), let updatedAt = DateHelpers.parseDateString(row.updatedAt) else {
            return nil
        }

        return Item(
            id: UUID(uuidString: row.id) ?? UUID(),
            manifestId: row.manifestId,
            name: row.name,
            itemType: row.itemType,
            logo: row.logo,
            folderId: row.folderId.flatMap { UUID(uuidString: $0) },
            folderPath: folderPath,
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
    ///   - fieldsByItem: Dictionary of scoped item key to array of fields
    ///   - folderPathsByFolderKey: Dictionary of scoped folder key to folder path array (optional)
    /// - Returns: Array of Item objects
    public static func mapRows(_ rows: [ItemRow], fieldsByItem: [String: [ItemField]], folderPathsByFolderKey: [String: [String]] = [:]) -> [Item] {
        return rows.compactMap { row in
            let fields = fieldsByItem[row.scopedItemKey] ?? []
            let folderPath = row.folderId.flatMap { folderPathsByFolderKey[scopedKey(manifestId: row.manifestId, id: $0.lowercased())] }
            return mapRow(row, fields: fields, folderPath: folderPath)
        }
    }
}
