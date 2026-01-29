import Foundation
import VaultModels

/// Repository for Item CRUD operations.
/// Handles fetching, creating, updating, and deleting items with their related data.
public class ItemRepository: BaseRepository {

    // MARK: - Read Operations

    /// Fetch all active items (not deleted, not in trash) with their fields.
    /// - Returns: Array of Item objects
    public func getAll() throws -> [Item] {
        // 1. Fetch all item rows
        let itemResults = try client.executeQuery(ItemQueries.getAllActive, params: [])
        let itemRows = itemResults.compactMap { ItemRow(from: $0) }

        if itemRows.isEmpty {
            return []
        }

        // 2. Fetch field values for all items
        let itemIds = itemRows.map { $0.id }
        let fieldQuery = ItemQueries.getFieldValuesForItems(itemIds.count)
        let fieldResults = try client.executeQuery(fieldQuery, params: itemIds.map { $0 as SqliteBindValue })
        let fieldRows = fieldResults.compactMap { FieldRow(from: $0) }

        // 3. Process fields into a dictionary by ItemId
        let fieldsByItem = FieldMapper.processFieldRows(fieldRows)

        // 4. Map rows to Item objects
        return ItemMapper.mapRows(itemRows, fieldsByItem: fieldsByItem)
    }

    /// Fetch a single item by ID with its fields.
    /// - Parameter itemId: The ID of the item to fetch
    /// - Returns: Item object or nil if not found
    public func getById(_ itemId: String) throws -> Item? {
        // 1. Fetch item row
        let itemResults = try client.executeQuery(ItemQueries.getById, params: [itemId])
        guard let itemRow = itemResults.first.flatMap({ ItemRow(from: $0) }) else {
            return nil
        }

        // 2. Fetch field values
        let fieldResults = try client.executeQuery(ItemQueries.getFieldValuesForItem, params: [itemId])
        let fieldRows = fieldResults.compactMap { SingleItemFieldRow(from: $0) }
        let fields = FieldMapper.processFieldRowsForSingleItem(fieldRows)

        // 3. Map to Item object
        return ItemMapper.mapRow(itemRow, fields: fields)
    }

    /// Fetch all unique email addresses from field values.
    /// - Returns: Array of email addresses
    public func getAllEmailAddresses() throws -> [String] {
        let results = try client.executeQuery(
            ItemQueries.getAllEmailAddresses,
            params: [FieldKey.loginEmail]
        )
        return results.compactMap { $0["Email"] as? String }
    }

    /// Get recently deleted items (in trash).
    /// - Returns: Array of items
    public func getRecentlyDeleted() throws -> [Item] {
        let itemResults = try client.executeQuery(ItemQueries.getRecentlyDeleted, params: [])
        let itemRows = itemResults.compactMap { ItemRow(from: $0) }

        if itemRows.isEmpty {
            return []
        }

        // Fetch fields for deleted items
        let itemIds = itemRows.map { $0.id }
        let fieldQuery = ItemQueries.getFieldValuesForItems(itemIds.count)
        let fieldResults = try client.executeQuery(fieldQuery, params: itemIds.map { $0 as SqliteBindValue })
        let fieldRows = fieldResults.compactMap { FieldRow(from: $0) }
        let fieldsByItem = FieldMapper.processFieldRows(fieldRows)

        return itemRows.compactMap { row in
            ItemMapper.mapDeletedItemRow(row, fields: fieldsByItem[row.id] ?? [])
        }
    }

    /// Get count of items in trash.
    /// - Returns: Number of items in trash
    public func getRecentlyDeletedCount() throws -> Int {
        let results = try client.executeQuery(ItemQueries.countRecentlyDeleted, params: [])
        return Int(results.first?["count"] as? Int64 ?? 0)
    }

    // MARK: - Write Operations

    /// Move an item to trash (set DeletedAt timestamp).
    /// - Parameter itemId: The ID of the item to trash
    /// - Returns: Number of rows affected
    @discardableResult
    public func trash(_ itemId: String) throws -> Int {
        let now = self.now()
        return try withTransaction {
            try client.executeUpdate(ItemQueries.trashItem, params: [now, now, itemId])
        }
    }

    /// Restore an item from trash (clear DeletedAt).
    /// - Parameter itemId: The ID of the item to restore
    /// - Returns: Number of rows affected
    @discardableResult
    public func restore(_ itemId: String) throws -> Int {
        let now = self.now()
        return try withTransaction {
            try client.executeUpdate(ItemQueries.restoreItem, params: [now, itemId])
        }
    }

    /// Permanently delete an item (tombstone).
    /// Converts item to tombstone and soft deletes all related data.
    /// - Parameter itemId: The ID of the item to permanently delete
    /// - Returns: Number of rows affected
    @discardableResult
    public func permanentlyDelete(_ itemId: String) throws -> Int {
        return try withTransaction {
            let now = self.now()

            // Soft delete related FieldValues
            try softDeleteByForeignKey(table: "FieldValues", foreignKey: "ItemId", foreignKeyValue: itemId)

            // Soft delete related data
            try softDeleteByForeignKey(table: "TotpCodes", foreignKey: "ItemId", foreignKeyValue: itemId)
            try softDeleteByForeignKey(table: "Attachments", foreignKey: "ItemId", foreignKeyValue: itemId)
            try softDeleteByForeignKey(table: "Passkeys", foreignKey: "ItemId", foreignKeyValue: itemId)

            if try tableExists("ItemTags") {
                try softDeleteByForeignKey(table: "ItemTags", foreignKey: "ItemId", foreignKeyValue: itemId)
            }
            if try tableExists("FieldHistories") {
                try softDeleteByForeignKey(table: "FieldHistories", foreignKey: "ItemId", foreignKeyValue: itemId)
            }

            // Convert item to tombstone
            return try client.executeUpdate(ItemQueries.tombstoneItem, params: [now, itemId])
        }
    }

    /// Create a new item with its fields.
    /// - Parameter item: The item to create
    /// - Returns: The ID of the created item
    @discardableResult
    public func create(_ item: Item) throws -> String {
        return try withTransaction {
            let now = self.now()
            let itemId = item.id.uuidString.uppercased()

            // 1. Insert Item
            try client.executeUpdate(ItemQueries.insertItem, params: [
                itemId,
                item.name as SqliteBindValue,
                item.itemType,
                nil, // LogoId - handled separately if needed
                item.folderId?.uuidString.uppercased() as SqliteBindValue,
                now,
                now,
                0
            ])

            // 2. Insert FieldValues
            try insertFieldValues(itemId: itemId, fields: item.fields, now: now)

            return itemId
        }
    }

    /// Update an existing item with its fields.
    /// - Parameter item: The item to update
    /// - Returns: Number of rows affected
    @discardableResult
    public func update(_ item: Item) throws -> Int {
        return try withTransaction {
            let now = self.now()
            let itemId = item.id.uuidString.uppercased()

            // 1. Update Item
            try client.executeUpdate(ItemQueries.updateItem, params: [
                item.name as SqliteBindValue,
                item.itemType,
                item.folderId?.uuidString.uppercased() as SqliteBindValue,
                nil, // LogoId update handled separately if needed
                now,
                itemId
            ])

            // 2. Update FieldValues using preserve-and-track strategy
            try updateFieldValues(itemId: itemId, fields: item.fields, now: now)

            return 1
        }
    }

    // MARK: - Private Helpers

    /// Insert field values for an item.
    private func insertFieldValues(itemId: String, fields: [ItemField], now: String) throws {
        for (index, field) in fields.enumerated() {
            if field.value.isEmpty { continue }

            try client.executeUpdate(FieldValueQueries.insert, params: [
                generateId(),
                itemId,
                field.isCustomField ? field.fieldKey : nil, // FieldDefinitionId for custom
                field.isCustomField ? nil : field.fieldKey, // FieldKey for system
                field.value,
                index * 100, // Weight for ordering
                now,
                now,
                0
            ])
        }
    }

    /// Update field values using preserve-and-track strategy.
    /// Preserves existing field value IDs when possible for stable merge behavior.
    private func updateFieldValues(itemId: String, fields: [ItemField], now: String) throws {
        // 1. Get existing field values
        let existingResults = try client.executeQuery(FieldValueQueries.getExistingForItem, params: [itemId])

        struct ExistingField {
            let id: String
            let fieldKey: String?
            let fieldDefinitionId: String?
            let value: String
        }

        let existingFields = existingResults.compactMap { row -> ExistingField? in
            guard let id = row["Id"] as? String else { return nil }
            return ExistingField(
                id: id,
                fieldKey: row["FieldKey"] as? String,
                fieldDefinitionId: row["FieldDefinitionId"] as? String,
                value: row["Value"] as? String ?? ""
            )
        }

        // 2. Build lookup by composite key (FieldKey or FieldDefinitionId)
        var existingByKey: [String: [ExistingField]] = [:]
        for existing in existingFields {
            let key = existing.fieldKey ?? existing.fieldDefinitionId ?? ""
            if existingByKey[key] == nil {
                existingByKey[key] = []
            }
            existingByKey[key]!.append(existing)
        }

        // 3. Track which existing IDs we've processed
        var processedIds = Set<String>()

        // 4. Process each field
        for (index, field) in fields.enumerated() {
            if field.value.isEmpty { continue }

            let existingForKey = existingByKey[field.fieldKey] ?? []
            let existingEntry = existingForKey.first

            if let existing = existingEntry {
                // Update existing if value changed
                processedIds.insert(existing.id)
                if existing.value != field.value {
                    try client.executeUpdate(FieldValueQueries.update, params: [
                        field.value,
                        index * 100,
                        now,
                        existing.id
                    ])
                }
            } else {
                // Insert new field value
                try client.executeUpdate(FieldValueQueries.insert, params: [
                    generateId(),
                    itemId,
                    field.isCustomField ? field.fieldKey : nil,
                    field.isCustomField ? nil : field.fieldKey,
                    field.value,
                    index * 100,
                    now,
                    now,
                    0
                ])
            }
        }

        // 5. Soft delete removed fields
        for existing in existingFields {
            if !processedIds.contains(existing.id) {
                try client.executeUpdate(FieldValueQueries.softDelete, params: [now, existing.id])
            }
        }
    }
}
