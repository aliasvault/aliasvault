package net.aliasvault.app.vaultstore.repositories

import android.util.Log
import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.VaultDatabase
import net.aliasvault.app.vaultstore.models.FieldKey
import net.aliasvault.app.vaultstore.models.FieldType
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.ItemField
import java.util.Calendar
import java.util.Date
import java.util.TimeZone
import java.util.UUID

/**
 * Repository for Item CRUD operations.
 * Handles fetching, creating, updating, and deleting items with their related data.
 */
class ItemRepository(database: VaultDatabase) : BaseRepository(database) {
    companion object {
        private const val TAG = "ItemRepository"

        private val MIN_DATE: Date = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            set(Calendar.YEAR, 1)
            set(Calendar.MONTH, Calendar.JANUARY)
            set(Calendar.DAY_OF_MONTH, 1)
            set(Calendar.HOUR_OF_DAY, 0)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.time
    }

    // MARK: - Read Operations

    /**
     * Fetch all active items (not deleted, not in trash) with their fields.
     *
     * @return List of Item objects.
     */
    @Suppress("LongMethod", "NestedBlockDepth", "LoopWithTooManyJumpStatements")
    fun getAll(): List<Item> {
        val itemQuery = """
            SELECT DISTINCT
              i.Id,
              i.Name,
              i.ItemType,
              i.FolderId,
              f.Name as FolderPath,
              l.FileData as Logo,
              CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
              CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
              CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
              i.CreatedAt,
              i.UpdatedAt
            FROM Items i
            LEFT JOIN Logos l ON i.LogoId = l.Id
            LEFT JOIN Folders f ON i.FolderId = f.Id
            WHERE i.IsDeleted = 0 AND i.DeletedAt IS NULL
            ORDER BY i.CreatedAt DESC
        """.trimIndent()

        val items = mutableListOf<Item>()
        val itemIds = mutableListOf<String>()

        val itemResults = executeQueryWithBlobs(itemQuery, emptyArray())
        for (row in itemResults) {
            try {
                val idString = row["Id"] as? String ?: continue
                val name = row["Name"] as? String
                val itemType = row["ItemType"] as? String ?: continue
                val folderId = row["FolderId"] as? String
                val folderPath = row["FolderPath"] as? String
                val logo = row["Logo"] as? ByteArray
                val hasPasskey = (row["HasPasskey"] as? Long) == 1L
                val hasAttachment = (row["HasAttachment"] as? Long) == 1L
                val hasTotp = (row["HasTotp"] as? Long) == 1L
                val createdAt = DateHelpers.parseDateString(row["CreatedAt"] as? String ?: "") ?: MIN_DATE
                val updatedAt = DateHelpers.parseDateString(row["UpdatedAt"] as? String ?: "") ?: MIN_DATE

                val item = Item(
                    id = UUID.fromString(idString),
                    name = name,
                    itemType = itemType,
                    logo = logo,
                    folderId = folderId?.let { UUID.fromString(it) },
                    folderPath = folderPath,
                    fields = emptyList(), // Will be populated below
                    hasPasskey = hasPasskey,
                    hasAttachment = hasAttachment,
                    hasTotp = hasTotp,
                    createdAt = createdAt,
                    updatedAt = updatedAt,
                )
                items.add(item)
                itemIds.add(idString)
            } catch (e: Exception) {
                Log.e(TAG, "Error parsing item row", e)
            }
        }

        // If no items, return empty list
        if (items.isEmpty()) {
            return emptyList()
        }

        // Get all field values for these items
        val (placeholders, _) = buildInClause(itemIds)
        val fieldQuery = """
            SELECT
              fv.ItemId,
              fv.FieldKey,
              fv.FieldDefinitionId,
              fd.Label as CustomLabel,
              fd.FieldType as CustomFieldType,
              fd.IsHidden as CustomIsHidden,
              fd.EnableHistory as CustomEnableHistory,
              fv.Value,
              fv.Weight as DisplayOrder
            FROM FieldValues fv
            LEFT JOIN FieldDefinitions fd ON fv.FieldDefinitionId = fd.Id
            WHERE fv.ItemId IN ($placeholders)
              AND fv.IsDeleted = 0
            ORDER BY fv.ItemId, fv.Weight
        """.trimIndent()

        // Build a map of itemId -> [ItemField]
        val fieldsByItemId = mutableMapOf<String, MutableList<ItemField>>()

        val fieldResults = executeQuery(fieldQuery, itemIds.toTypedArray())
        for (row in fieldResults) {
            try {
                val itemIdString = row["ItemId"] as? String ?: continue
                val fieldKey = row["FieldKey"] as? String
                val fieldDefinitionId = row["FieldDefinitionId"] as? String
                val customLabel = row["CustomLabel"] as? String
                val customFieldType = row["CustomFieldType"] as? String
                val customIsHidden = (row["CustomIsHidden"] as? Long) == 1L
                val customEnableHistory = (row["CustomEnableHistory"] as? Long) == 1L
                val value = row["Value"] as? String ?: ""
                val displayOrder = (row["DisplayOrder"] as? Long)?.toInt() ?: 0

                // Determine if this is a custom field
                val isCustomField = fieldDefinitionId != null && fieldKey == null

                // Resolve the effective field key
                val effectiveFieldKey = fieldKey ?: fieldDefinitionId ?: ""

                // Resolve field metadata
                val metadata = resolveFieldMetadata(
                    fieldKey = effectiveFieldKey,
                    customLabel = customLabel,
                    customFieldType = customFieldType,
                    customIsHidden = customIsHidden,
                    customEnableHistory = customEnableHistory,
                    isCustomField = isCustomField,
                )

                val field = ItemField(
                    fieldKey = effectiveFieldKey,
                    label = metadata.label,
                    fieldType = metadata.fieldType,
                    value = value,
                    isHidden = metadata.isHidden,
                    displayOrder = displayOrder,
                    isCustomField = isCustomField,
                    enableHistory = metadata.enableHistory,
                )

                fieldsByItemId.getOrPut(itemIdString) { mutableListOf() }.add(field)
            } catch (e: Exception) {
                Log.e(TAG, "Error parsing field row", e)
            }
        }

        // Assign fields to items
        return items.map { item ->
            val fields = fieldsByItemId[item.id.toString().uppercase()] ?: emptyList()
            item.copy(fields = fields)
        }
    }

    /**
     * Fetch a single item by ID with its fields.
     *
     * @param itemId The ID of the item to fetch.
     * @return Item object or null if not found.
     */
    fun getById(itemId: String): Item? {
        val itemQuery = """
            SELECT DISTINCT
              i.Id,
              i.Name,
              i.ItemType,
              i.FolderId,
              f.Name as FolderPath,
              l.FileData as Logo,
              CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
              CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
              CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
              i.CreatedAt,
              i.UpdatedAt
            FROM Items i
            LEFT JOIN Logos l ON i.LogoId = l.Id
            LEFT JOIN Folders f ON i.FolderId = f.Id
            WHERE i.Id = ? AND i.IsDeleted = 0 AND i.DeletedAt IS NULL
        """.trimIndent()

        val itemResults = executeQueryWithBlobs(itemQuery, arrayOf(itemId.uppercase()))
        val row = itemResults.firstOrNull() ?: return null

        return try {
            val idString = row["Id"] as? String ?: return null
            val name = row["Name"] as? String
            val itemType = row["ItemType"] as? String ?: return null
            val folderId = row["FolderId"] as? String
            val folderPath = row["FolderPath"] as? String
            val logo = row["Logo"] as? ByteArray
            val hasPasskey = (row["HasPasskey"] as? Long) == 1L
            val hasAttachment = (row["HasAttachment"] as? Long) == 1L
            val hasTotp = (row["HasTotp"] as? Long) == 1L
            val createdAt = DateHelpers.parseDateString(row["CreatedAt"] as? String ?: "") ?: MIN_DATE
            val updatedAt = DateHelpers.parseDateString(row["UpdatedAt"] as? String ?: "") ?: MIN_DATE

            // Get field values for this item
            val fieldQuery = """
                SELECT
                  fv.FieldKey,
                  fv.FieldDefinitionId,
                  fd.Label as CustomLabel,
                  fd.FieldType as CustomFieldType,
                  fd.IsHidden as CustomIsHidden,
                  fd.EnableHistory as CustomEnableHistory,
                  fv.Value,
                  fv.Weight as DisplayOrder
                FROM FieldValues fv
                LEFT JOIN FieldDefinitions fd ON fv.FieldDefinitionId = fd.Id
                WHERE fv.ItemId = ? AND fv.IsDeleted = 0
                ORDER BY fv.Weight
            """.trimIndent()

            val fields = mutableListOf<ItemField>()
            val fieldResults = executeQuery(fieldQuery, arrayOf(idString))
            for (fieldRow in fieldResults) {
                val fieldKey = fieldRow["FieldKey"] as? String
                val fieldDefinitionId = fieldRow["FieldDefinitionId"] as? String
                val customLabel = fieldRow["CustomLabel"] as? String
                val customFieldType = fieldRow["CustomFieldType"] as? String
                val customIsHidden = (fieldRow["CustomIsHidden"] as? Long) == 1L
                val customEnableHistory = (fieldRow["CustomEnableHistory"] as? Long) == 1L
                val value = fieldRow["Value"] as? String ?: ""
                val displayOrder = (fieldRow["DisplayOrder"] as? Long)?.toInt() ?: 0

                val isCustomField = fieldDefinitionId != null && fieldKey == null
                val effectiveFieldKey = fieldKey ?: fieldDefinitionId ?: ""

                val metadata = resolveFieldMetadata(
                    fieldKey = effectiveFieldKey,
                    customLabel = customLabel,
                    customFieldType = customFieldType,
                    customIsHidden = customIsHidden,
                    customEnableHistory = customEnableHistory,
                    isCustomField = isCustomField,
                )

                fields.add(
                    ItemField(
                        fieldKey = effectiveFieldKey,
                        label = metadata.label,
                        fieldType = metadata.fieldType,
                        value = value,
                        isHidden = metadata.isHidden,
                        displayOrder = displayOrder,
                        isCustomField = isCustomField,
                        enableHistory = metadata.enableHistory,
                    ),
                )
            }

            Item(
                id = UUID.fromString(idString),
                name = name,
                itemType = itemType,
                logo = logo,
                folderId = folderId?.let { UUID.fromString(it) },
                folderPath = folderPath,
                fields = fields,
                hasPasskey = hasPasskey,
                hasAttachment = hasAttachment,
                hasTotp = hasTotp,
                createdAt = createdAt,
                updatedAt = updatedAt,
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing item by ID", e)
            null
        }
    }

    /**
     * Fetch all unique email addresses from field values.
     *
     * @return List of email addresses.
     */
    fun getAllEmailAddresses(): List<String> {
        val results = executeQuery(
            """
            SELECT DISTINCT fv.Value as Email
            FROM FieldValues fv
            INNER JOIN Items i ON fv.ItemId = i.Id
            WHERE fv.FieldKey = ?
              AND fv.IsDeleted = 0
              AND i.IsDeleted = 0
              AND i.DeletedAt IS NULL
            """.trimIndent(),
            arrayOf(FieldKey.LOGIN_EMAIL),
        )
        return results.mapNotNull { it["Email"] as? String }
    }

    /**
     * Get recently deleted items (in trash).
     * Note: This returns minimal Item objects without fields for performance.
     *
     * @return List of items in trash.
     */
    @Suppress("LongMethod", "LoopWithTooManyJumpStatements")
    fun getRecentlyDeleted(): List<Item> {
        val query = """
            SELECT DISTINCT
              i.Id,
              i.Name,
              i.ItemType,
              i.FolderId,
              f.Name as FolderPath,
              l.FileData as Logo,
              CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
              CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
              CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
              i.CreatedAt,
              i.UpdatedAt,
              i.DeletedAt
            FROM Items i
            LEFT JOIN Logos l ON i.LogoId = l.Id
            LEFT JOIN Folders f ON i.FolderId = f.Id
            WHERE i.IsDeleted = 0 AND i.DeletedAt IS NOT NULL
            ORDER BY i.DeletedAt DESC
        """.trimIndent()

        val items = mutableListOf<Item>()
        val results = executeQueryWithBlobs(query, emptyArray())

        for (row in results) {
            try {
                val idString = row["Id"] as? String ?: continue
                val name = row["Name"] as? String
                val itemType = row["ItemType"] as? String ?: continue
                val folderId = row["FolderId"] as? String
                val folderPath = row["FolderPath"] as? String
                val logo = row["Logo"] as? ByteArray
                val hasPasskey = (row["HasPasskey"] as? Long) == 1L
                val hasAttachment = (row["HasAttachment"] as? Long) == 1L
                val hasTotp = (row["HasTotp"] as? Long) == 1L
                val createdAt = DateHelpers.parseDateString(row["CreatedAt"] as? String ?: "") ?: MIN_DATE
                val updatedAt = DateHelpers.parseDateString(row["UpdatedAt"] as? String ?: "") ?: MIN_DATE

                items.add(
                    Item(
                        id = UUID.fromString(idString),
                        name = name,
                        itemType = itemType,
                        logo = logo,
                        folderId = folderId?.let { UUID.fromString(it) },
                        folderPath = folderPath,
                        fields = emptyList(), // Not loading fields for trash items
                        hasPasskey = hasPasskey,
                        hasAttachment = hasAttachment,
                        hasTotp = hasTotp,
                        createdAt = createdAt,
                        updatedAt = updatedAt,
                    ),
                )
            } catch (e: Exception) {
                Log.e(TAG, "Error parsing recently deleted item row", e)
            }
        }

        return items
    }

    /**
     * Get the database version from the __EFMigrationsHistory table.
     *
     * @return Database version string (e.g., "1.0.0").
     */
    fun getDatabaseVersion(): String {
        val query = "SELECT MigrationId FROM __EFMigrationsHistory ORDER BY MigrationId DESC LIMIT 1"
        val results = executeQuery(query, emptyArray())

        if (results.isEmpty()) {
            Log.d(TAG, "No migrations found in database, returning default version")
            return "0.0.0"
        }

        val migrationId = results[0]["MigrationId"] as? String
        if (migrationId == null) {
            return "0.0.0"
        }

        val versionRegex = Regex("_(\\d+\\.\\d+\\.\\d+)-")
        val match = versionRegex.find(migrationId)

        return if (match != null && match.groupValues.size > 1) {
            match.groupValues[1]
        } else {
            Log.d(TAG, "Could not extract version from migration ID '$migrationId', returning default")
            "0.0.0"
        }
    }

    /**
     * Get count of items in trash.
     *
     * @return Number of items in trash.
     */
    fun getRecentlyDeletedCount(): Int {
        val results = executeQuery(
            """
            SELECT COUNT(*) as count
            FROM Items
            WHERE IsDeleted = 0 AND DeletedAt IS NOT NULL
            """.trimIndent(),
            emptyArray(),
        )
        return (results.firstOrNull()?.get("count") as? Long)?.toInt() ?: 0
    }

    // MARK: - Write Operations

    /**
     * Move an item to trash (set DeletedAt timestamp).
     *
     * @param itemId The ID of the item to trash.
     * @return Number of rows affected.
     */
    fun trash(itemId: String): Int {
        return withTransaction {
            val now = now()
            executeUpdate(
                "UPDATE Items SET DeletedAt = ?, UpdatedAt = ? WHERE Id = ?",
                arrayOf(now, now, itemId),
            )
        }
    }

    /**
     * Restore an item from trash (clear DeletedAt).
     *
     * @param itemId The ID of the item to restore.
     * @return Number of rows affected.
     */
    fun restore(itemId: String): Int {
        return withTransaction {
            val now = now()
            executeUpdate(
                "UPDATE Items SET DeletedAt = NULL, UpdatedAt = ? WHERE Id = ?",
                arrayOf(now, itemId),
            )
        }
    }

    /**
     * Permanently delete an item (tombstone).
     * Converts item to tombstone and soft deletes all related data.
     *
     * @param itemId The ID of the item to permanently delete.
     * @return Number of rows affected.
     */
    fun permanentlyDelete(itemId: String): Int {
        return withTransaction {
            val now = now()

            // Soft delete related FieldValues
            softDeleteByForeignKey("FieldValues", "ItemId", itemId)

            // Soft delete related data
            softDeleteByForeignKey("TotpCodes", "ItemId", itemId)
            softDeleteByForeignKey("Attachments", "ItemId", itemId)
            softDeleteByForeignKey("Passkeys", "ItemId", itemId)

            if (tableExists("ItemTags")) {
                softDeleteByForeignKey("ItemTags", "ItemId", itemId)
            }
            if (tableExists("FieldHistories")) {
                softDeleteByForeignKey("FieldHistories", "ItemId", itemId)
            }

            // Convert item to tombstone
            executeUpdate(
                """
                UPDATE Items
                SET Name = NULL,
                    ItemType = NULL,
                    LogoId = NULL,
                    FolderId = NULL,
                    DeletedAt = NULL,
                    IsDeleted = 1,
                    UpdatedAt = ?
                WHERE Id = ?
                """.trimIndent(),
                arrayOf(now, itemId),
            )
        }
    }

    /**
     * Create a new item with its fields.
     *
     * @param item The item to create.
     * @return The ID of the created item.
     */
    @Suppress("UNUSED_PARAMETER") // Method under construction, will be implemented
    fun create(item: Item): String {
        error("Create operations should use VaultMutate - repository pattern under construction")
    }

    /**
     * Update an existing item with its fields.
     *
     * @param item The item to update.
     * @return Number of rows affected.
     */
    @Suppress("UNUSED_PARAMETER") // Method under construction, will be implemented
    fun update(item: Item): Int {
        error("Update operations should use VaultMutate - repository pattern under construction")
    }

    // MARK: - Helper Methods

    /**
     * Helper class to hold resolved field metadata.
     */
    private data class FieldMetadata(
        val label: String,
        val fieldType: String,
        val isHidden: Boolean,
        val enableHistory: Boolean,
    )

    /**
     * Resolve field metadata for system fields and custom fields.
     */
    @Suppress("CyclomaticComplexMethod", "LongParameterList")
    // LongParameterList suppressed: All parameters are needed to determine field metadata
    private fun resolveFieldMetadata(
        fieldKey: String,
        customLabel: String?,
        customFieldType: String?,
        customIsHidden: Boolean,
        customEnableHistory: Boolean,
        isCustomField: Boolean,
    ): FieldMetadata {
        if (isCustomField) {
            return FieldMetadata(
                label = customLabel ?: fieldKey,
                fieldType = customFieldType ?: FieldType.TEXT,
                isHidden = customIsHidden,
                enableHistory = customEnableHistory,
            )
        }

        // System field metadata based on FieldKey constants
        return when (fieldKey) {
            FieldKey.LOGIN_USERNAME -> FieldMetadata("Username", FieldType.TEXT, false, false)
            FieldKey.LOGIN_PASSWORD -> FieldMetadata("Password", FieldType.PASSWORD, true, true)
            FieldKey.LOGIN_EMAIL -> FieldMetadata("Email", FieldType.EMAIL, false, false)
            FieldKey.LOGIN_URL -> FieldMetadata("URL", FieldType.U_R_L, false, false)
            FieldKey.CARD_NUMBER -> FieldMetadata("Card Number", FieldType.TEXT, true, false)
            FieldKey.CARD_CARDHOLDER_NAME -> FieldMetadata("Cardholder Name", FieldType.TEXT, false, false)
            FieldKey.CARD_EXPIRY_MONTH -> FieldMetadata("Expiry Month", FieldType.TEXT, false, false)
            FieldKey.CARD_EXPIRY_YEAR -> FieldMetadata("Expiry Year", FieldType.TEXT, false, false)
            FieldKey.CARD_CVV -> FieldMetadata("CVV", FieldType.PASSWORD, true, false)
            FieldKey.CARD_PIN -> FieldMetadata("PIN", FieldType.PASSWORD, true, false)
            FieldKey.ALIAS_FIRST_NAME -> FieldMetadata("First Name", FieldType.TEXT, false, false)
            FieldKey.ALIAS_LAST_NAME -> FieldMetadata("Last Name", FieldType.TEXT, false, false)
            FieldKey.ALIAS_GENDER -> FieldMetadata("Gender", FieldType.TEXT, false, false)
            FieldKey.ALIAS_BIRTHDATE -> FieldMetadata("Birth Date", FieldType.DATE, false, false)
            FieldKey.NOTES_CONTENT -> FieldMetadata("Notes", FieldType.TEXT_AREA, false, false)
            else -> FieldMetadata(fieldKey, FieldType.TEXT, false, false)
        }
    }

    /**
     * Execute a SELECT query that may return BLOB columns.
     * Unlike executeQuery which converts all params to strings, this preserves ByteArray types.
     */
    private fun executeQueryWithBlobs(query: String, params: Array<Any?>): List<Map<String, Any?>> {
        val db = database.dbConnection ?: error("Database not initialized")
        val cursor = db.query(query, params.map { it?.toString() }.toTypedArray())

        val results = mutableListOf<Map<String, Any?>>()
        cursor.use {
            val columnNames = it.columnNames
            while (it.moveToNext()) {
                val row = mutableMapOf<String, Any?>()
                for (columnName in columnNames) {
                    when (it.getType(it.getColumnIndexOrThrow(columnName))) {
                        android.database.Cursor.FIELD_TYPE_NULL -> row[columnName] = null
                        android.database.Cursor.FIELD_TYPE_INTEGER -> row[columnName] = it.getLong(
                            it.getColumnIndexOrThrow(columnName),
                        )
                        android.database.Cursor.FIELD_TYPE_FLOAT -> row[columnName] = it.getDouble(
                            it.getColumnIndexOrThrow(columnName),
                        )
                        android.database.Cursor.FIELD_TYPE_STRING -> row[columnName] = it.getString(
                            it.getColumnIndexOrThrow(columnName),
                        )
                        android.database.Cursor.FIELD_TYPE_BLOB -> row[columnName] = it.getBlob(
                            it.getColumnIndexOrThrow(columnName),
                        )
                    }
                }
                results.add(row)
            }
        }

        return results
    }
}
