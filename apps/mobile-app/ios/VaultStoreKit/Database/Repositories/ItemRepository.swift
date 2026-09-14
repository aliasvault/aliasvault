import Foundation
import VaultModels

/// Repository for reading items and appending field values.
public class ItemRepository: BaseRepository {

    // MARK: - Read Operations

    /// Build folder paths for all folders, keyed by scoped folder key (see `scopedKey`).
    /// The tree is walked per manifest: a parent link only ever resolves inside its own namespace.
    /// - Returns: Dictionary of scoped folder key to folder path array
    private func buildFolderPaths() throws -> [String: [String]] {
        var folderPathMap: [String: [String]] = [:]

        let folderResults: [[String: Any]]
        do {
            folderResults = try client.executeQuery(ItemQueries.getAllFolders, params: [])
        } catch {
            // Folders table may not exist in older vault versions
            return folderPathMap
        }

        var foldersByManifest: [String: [FolderUtils.Folder]] = [:]
        for row in folderResults {
            guard let manifestId = row["ManifestId"] as? String, let idString = row["Id"] as? String, let id = UUID(uuidString: idString), let name = row["Name"] as? String else {
                continue
            }
            let parentFolderId = (row["ParentFolderId"] as? String).flatMap { UUID(uuidString: $0) }
            foldersByManifest[manifestId, default: []].append(FolderUtils.Folder(id: id, name: name, parentFolderId: parentFolderId))
        }

        for (manifestId, folders) in foldersByManifest {
            for folder in folders {
                let path = FolderUtils.getFolderPath(folderId: folder.id, folders: folders)
                if !path.isEmpty {
                    folderPathMap[scopedKey(manifestId: manifestId, id: folder.id.uuidString.lowercased())] = path
                }
            }
        }

        return folderPathMap
    }

    /// Fetch all active items (not deleted, not in trash, not archived) with their fields.
    /// - Returns: Array of Item objects
    public func getAll() throws -> [Item] {
        let itemRows = try client.executeQuery(ItemQueries.getAllActive, params: []).compactMap { ItemRow(from: $0) }
        if itemRows.isEmpty {
            return []
        }

        // Fields are matched on the whole (ManifestId, Id) key, bound as one pair per item.
        let keyParams = itemRows.flatMap { [$0.manifestId as SqliteBindValue, $0.id as SqliteBindValue] }
        let fieldRows = try client.executeQuery(ItemQueries.getFieldValuesForItems(itemRows.count), params: keyParams).compactMap { FieldRow(from: $0) }
        let fieldsByItem = FieldMapper.processFieldRows(fieldRows)
        let folderPaths = try buildFolderPaths()

        return ItemMapper.mapRows(itemRows, fieldsByItem: fieldsByItem, folderPathsByFolderKey: folderPaths)
    }

    // MARK: - Write Operations

    /// Append a single value to a multi-value field on an existing item without touching other field rows.
    /// - Parameters:
    ///   - itemId: The id of the item to append the value to (lowercase string)
    ///   - fieldKey: The system FieldKey to append under (e.g. `FieldKey.loginUrl`)
    ///   - value: The value to append
    ///   - manifestId: The manifest the item belongs to
    /// - Returns: The number of rows affected by the parent Item's UpdatedAt bump, 0 when no such item exists
    @discardableResult
    public func appendFieldValue(itemId: String, manifestId: String, fieldKey: String, value: String) throws -> Int {
        return try withTransaction {
            let now = self.now()
            let weight = FieldValueQueries.defaultWeight(forFieldKey: fieldKey)
            try client.executeUpdate(FieldValueQueries.insert, params: [generateId(), itemId, nil, fieldKey, value, weight, now, now, 0, manifestId])

            // Bump the parent Item's UpdatedAt so the change is picked up by the sync layer.
            return try client.executeUpdate(ItemQueries.touchItem, params: [now, itemId, manifestId])
        }
    }
}
