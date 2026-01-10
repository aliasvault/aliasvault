package net.aliasvault.app.vaultstore

import android.util.Base64
import android.util.Log
import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.interfaces.CredentialOperationCallback
import net.aliasvault.app.vaultstore.models.Alias
import net.aliasvault.app.vaultstore.models.Credential
import net.aliasvault.app.vaultstore.models.FieldKey
import net.aliasvault.app.vaultstore.models.FieldType
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.ItemField
import net.aliasvault.app.vaultstore.models.Password
import net.aliasvault.app.vaultstore.models.Service
import java.util.Calendar
import java.util.Date
import java.util.TimeZone
import java.util.UUID

/**
 * Handles SQL query operations on the vault database.
 */
class VaultQuery(
    private val database: VaultDatabase,
) {
    companion object {
        private const val TAG = "VaultQuery"

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

    // region SQL Query Execution

    /**
     * Execute a read-only SQL query (SELECT) on the vault.
     */
    @Suppress("NestedBlockDepth")
    fun executeQuery(query: String, params: Array<Any?>): List<Map<String, Any?>> {
        val results = mutableListOf<Map<String, Any?>>()

        database.dbConnection?.let { db ->
            val convertedParams = params.map { param ->
                if (param is String && param.startsWith("av-base64-to-blob:")) {
                    val base64 = param.substring("av-base64-to-blob:".length)
                    Base64.decode(base64, Base64.NO_WRAP)
                } else {
                    param
                }
            }.toTypedArray()

            val cursor = db.query(query, convertedParams.map { it?.toString() }.toTypedArray())

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
        }

        return results
    }

    /**
     * Execute an SQL update on the vault that mutates it.
     */
    fun executeUpdate(query: String, params: Array<Any?>): Int {
        database.dbConnection?.let { db ->
            val convertedParams = params.map { param ->
                if (param is String && param.startsWith("av-base64-to-blob:")) {
                    val base64 = param.substring("av-base64-to-blob:".length)
                    Base64.decode(base64, Base64.NO_WRAP)
                } else {
                    param
                }
            }.toTypedArray()

            // Execute the statement using compileStatement for non-SELECT queries
            val stmt = db.compileStatement(query)
            try {
                // Bind parameters
                convertedParams.forEachIndexed { index, param ->
                    when (param) {
                        null -> stmt.bindNull(index + 1)
                        is ByteArray -> stmt.bindBlob(index + 1, param)
                        is Long -> stmt.bindLong(index + 1, param)
                        is Double -> stmt.bindDouble(index + 1, param)
                        else -> stmt.bindString(index + 1, param.toString())
                    }
                }
                stmt.execute()
            } finally {
                stmt.close()
            }

            // Get the number of affected rows
            val cursor = db.rawQuery("SELECT changes()", null)
            cursor.use {
                if (it.moveToFirst()) {
                    return it.getInt(0)
                }
            }
        }
        return 0
    }

    /**
     * Execute a raw SQL command on the vault without parameters.
     */
    fun executeRaw(query: String) {
        database.dbConnection?.let { db ->
            val statements = query.split(";")

            for (statement in statements) {
                val trimmedStatement = statement.smartTrim()

                if (trimmedStatement.isEmpty() ||
                    trimmedStatement.uppercase().startsWith("BEGIN") ||
                    trimmedStatement.uppercase().startsWith("COMMIT") ||
                    trimmedStatement.uppercase().startsWith("ROLLBACK")
                ) {
                    continue
                }

                // Use compileStatement and execute for all non-SELECT statements
                val stmt = db.compileStatement(trimmedStatement)
                try {
                    stmt.execute()
                } finally {
                    stmt.close()
                }
            }
        }
    }

    // endregion

    // region Item Operations (New Field-Based Model)

    /**
     * Get all items from the vault using the new field-based model.
     */
    @Suppress("LongMethod", "NestedBlockDepth")
    fun getAllItems(): List<Item> {
        if (database.dbConnection == null) {
            error("Database not initialized")
        }

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
        """

        val items = mutableListOf<Item>()
        val itemIds = mutableListOf<String>()

        database.dbConnection?.query(itemQuery)?.use { cursor ->
            while (cursor.moveToNext()) {
                try {
                    val idString = cursor.getString(0)
                    val name = if (cursor.isNull(1)) null else cursor.getString(1)
                    val itemType = cursor.getString(2)
                    val folderId = if (cursor.isNull(3)) null else cursor.getString(3)
                    val folderPath = if (cursor.isNull(4)) null else cursor.getString(4)
                    val logo = if (cursor.isNull(5)) null else cursor.getBlob(5)
                    val hasPasskey = cursor.getInt(6) == 1
                    val hasAttachment = cursor.getInt(7) == 1
                    val hasTotp = cursor.getInt(8) == 1
                    val createdAt = DateHelpers.parseDateString(cursor.getString(9)) ?: MIN_DATE
                    val updatedAt = DateHelpers.parseDateString(cursor.getString(10)) ?: MIN_DATE

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
        }

        // If no items, return empty list
        if (items.isEmpty()) {
            return emptyList()
        }

        // Get all field values for these items
        val placeholders = itemIds.joinToString(",") { "?" }
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
        """

        // Build a map of itemId -> [ItemField]
        val fieldsByItemId = mutableMapOf<String, MutableList<ItemField>>()

        database.dbConnection?.query(fieldQuery, itemIds.toTypedArray())?.use { cursor ->
            while (cursor.moveToNext()) {
                try {
                    val itemIdString = cursor.getString(0)
                    val fieldKey = if (cursor.isNull(1)) null else cursor.getString(1)
                    val fieldDefinitionId = if (cursor.isNull(2)) null else cursor.getString(2)
                    val customLabel = if (cursor.isNull(3)) null else cursor.getString(3)
                    val customFieldType = if (cursor.isNull(4)) null else cursor.getString(4)
                    val customIsHidden = if (cursor.isNull(5)) false else cursor.getInt(5) == 1
                    val customEnableHistory = if (cursor.isNull(6)) false else cursor.getInt(6) == 1
                    val value = if (cursor.isNull(7)) "" else cursor.getString(7)
                    val displayOrder = if (cursor.isNull(8)) 0 else cursor.getInt(8)

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
        }

        // Assign fields to items
        return items.map { item ->
            val fields = fieldsByItemId[item.id.toString().uppercase()] ?: emptyList()
            item.copy(fields = fields)
        }
    }

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

    // endregion

    // region Legacy Credential Operations (Compatibility Layer)

    /**
     * Get all credentials from the vault.
     * This method converts the new Items model back to the legacy Credential model for compatibility.
     */
    fun getAllCredentials(): List<Credential> {
        val items = getAllItems()
        return items.mapNotNull { convertItemToCredential(it) }
    }

    /**
     * Convert an Item to the legacy Credential format.
     */
    private fun convertItemToCredential(item: Item): Credential? {
        // Create a Service from the item
        val service = Service(
            id = item.id,
            name = item.name,
            url = item.url,
            logo = item.logo,
            createdAt = item.createdAt,
            updatedAt = item.updatedAt,
            isDeleted = false,
        )

        // Create an Alias if the item has alias fields
        var alias: Alias? = null
        if (item.firstName != null || item.lastName != null || item.email != null) {
            alias = Alias(
                id = item.id,
                gender = item.getFieldValue(FieldKey.ALIAS_GENDER),
                firstName = item.firstName,
                lastName = item.lastName,
                nickName = null,
                birthDate = MIN_DATE, // TODO: Parse birthdate from field value
                email = item.email,
                createdAt = item.createdAt,
                updatedAt = item.updatedAt,
                isDeleted = false,
            )
        }

        // Create a Password if the item has a password field
        var password: Password? = null
        item.password?.let { passwordValue ->
            password = Password(
                id = UUID.randomUUID(),
                credentialId = item.id,
                value = passwordValue,
                createdAt = item.createdAt,
                updatedAt = item.updatedAt,
                isDeleted = false,
            )
        }

        return Credential(
            id = item.id,
            alias = alias,
            service = service,
            username = item.username,
            notes = item.getFieldValue("login.notes"),
            password = password,
            createdAt = item.createdAt,
            updatedAt = item.updatedAt,
            isDeleted = false,
        )
    }

    /**
     * Attempts to get all credentials using only the cached encryption key.
     */
    fun tryGetAllCredentials(callback: CredentialOperationCallback, crypto: VaultCrypto, unlockVault: () -> Unit): Boolean {
        if (crypto.encryptionKey == null) {
            Log.d(TAG, "Encryption key not in memory, authentication required")
            return false
        }

        try {
            if (!database.isVaultUnlocked()) {
                unlockVault()
            }

            callback.onSuccess(getAllCredentials())
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error retrieving credentials", e)
            callback.onError(e)
            return false
        }
    }

    /**
     * Get the database version from the __EFMigrationsHistory table.
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

    // endregion

    // region Helper Functions

    private fun String.smartTrim(): String {
        val invisible = "[\\uFEFF\\u200B\\u00A0\\u202A-\\u202E\\u2060\\u180E]"
        return this.replace(Regex("^($invisible)+|($invisible)+$"), "").trim()
    }

    // endregion
}
