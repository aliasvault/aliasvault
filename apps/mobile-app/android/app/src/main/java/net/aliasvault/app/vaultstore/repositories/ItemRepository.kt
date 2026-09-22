package net.aliasvault.app.vaultstore.repositories

import android.util.Log
import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.VaultDatabase
import net.aliasvault.app.vaultstore.models.AppIcons
import net.aliasvault.app.vaultstore.models.FieldKey
import net.aliasvault.app.vaultstore.models.FieldType
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.ItemField
import net.aliasvault.app.vaultstore.models.TotpCode
import net.aliasvault.app.vaultstore.queries.ItemQueries
import net.aliasvault.app.vaultstore.utils.FolderUtils
import java.util.Calendar
import java.util.Date
import java.util.TimeZone
import java.util.UUID

/**
 * Repository for the item reads the autofill service needs.
 */
class ItemRepository(database: VaultDatabase) : BaseRepository(database) {
    companion object {
        private const val TAG = "ItemRepository"
        private const val LOGO_KIND_BUILTIN = "builtin"

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
     * The bytes an item's logo is drawn from. A built-in logo carries none: it is drawn from the shared catalog, keyed by its Source.
     */
    private fun resolveLogo(row: Map<String, Any?>): ByteArray? {
        if (row["LogoKind"] as? String == LOGO_KIND_BUILTIN) {
            return (row["LogoSource"] as? String)?.let { AppIcons.svgFor(it) }?.toByteArray(Charsets.UTF_8)
        }
        return row["Logo"] as? ByteArray
    }

    /**
     * Build folder paths for all folders, keyed by the folder's scoped key (manifest + id). The tree is walked
     * one manifest at a time: a parent link only ever resolves inside its own namespace.
     *
     * @return Map of scoped folder key to folder path array.
     */
    private fun buildFolderPaths(): Map<String, List<String>> {
        val folderPathMap = mutableMapOf<String, List<String>>()

        try {
            val folderResults = executeQuery(ItemQueries.GET_ALL_FOLDERS, emptyArray())
            if (folderResults.isEmpty()) {
                return folderPathMap
            }

            val foldersByManifest = mutableMapOf<String, MutableList<FolderUtils.Folder>>()
            for (row in folderResults) {
                try {
                    val idString = row["Id"] as? String
                    val manifestId = row["ManifestId"] as? String
                    val name = row["Name"] as? String
                    if (idString == null || manifestId == null || name == null) continue
                    val parentFolderId = (row["ParentFolderId"] as? String)?.let { UUID.fromString(it) }
                    foldersByManifest.getOrPut(manifestId) { mutableListOf() }.add(FolderUtils.Folder(UUID.fromString(idString), name, parentFolderId))
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing folder row", e)
                }
            }

            for ((manifestId, folders) in foldersByManifest) {
                for (folder in folders) {
                    val path = FolderUtils.getFolderPath(folder.id, folders)
                    if (path.isNotEmpty()) {
                        folderPathMap[scopedKey(manifestId, folder.id.toString())] = path
                    }
                }
            }

            return folderPathMap
        } catch (e: Exception) {
            // Folders table may not exist in older vault versions
            Log.e(TAG, "Error building folder paths", e)
            return folderPathMap
        }
    }

    /**
     * Fetch all active items (not deleted, not in trash, not archived) with their fields.
     *
     * @return List of Item objects.
     */
    @Suppress("LongMethod", "NestedBlockDepth", "LoopWithTooManyJumpStatements")
    fun getAll(): List<Item> {
        val items = mutableListOf<Item>()

        // Build folder paths
        val folderPaths = buildFolderPaths()

        val itemResults = executeQuery(ItemQueries.GET_ALL_ACTIVE, emptyArray())
        for (row in itemResults) {
            try {
                val idString = row["Id"] as? String ?: continue
                val manifestId = row["ManifestId"] as? String ?: continue
                val name = row["Name"] as? String
                val itemType = row["ItemType"] as? String ?: continue
                val folderId = row["FolderId"] as? String
                val logo = resolveLogo(row)
                val hasPasskey = (row["HasPasskey"] as? Long) == 1L
                val hasAttachment = (row["HasAttachment"] as? Long) == 1L
                val hasTotp = (row["HasTotp"] as? Long) == 1L
                val createdAt = DateHelpers.parseDateString(row["CreatedAt"] as? String ?: "") ?: MIN_DATE
                val updatedAt = DateHelpers.parseDateString(row["UpdatedAt"] as? String ?: "") ?: MIN_DATE

                // Get folder path if item is in a folder
                val folderUuid = folderId?.let { UUID.fromString(it) }
                val folderPath = folderId?.let { folderPaths[scopedKey(manifestId, it)] }

                items.add(
                    Item(
                        id = UUID.fromString(idString),
                        manifestId = manifestId,
                        name = name,
                        itemType = itemType,
                        logo = logo,
                        folderId = folderUuid,
                        folderPath = folderPath,
                        fields = emptyList(), // Will be populated below
                        hasPasskey = hasPasskey,
                        hasAttachment = hasAttachment,
                        hasTotp = hasTotp,
                        createdAt = createdAt,
                        updatedAt = updatedAt,
                    ),
                )
            } catch (e: Exception) {
                Log.e(TAG, "Error parsing item row", e)
            }
        }

        // If no items, return empty list
        if (items.isEmpty()) {
            return emptyList()
        }

        // Get all field values for these items, matched on the whole (manifest, id) key
        val fieldQuery = ItemQueries.getFieldValuesForItems(items.size)
        val keyBindings = items.flatMap { listOf<Any?>(it.manifestId, it.id.toString().lowercase()) }.toTypedArray()

        // Build a map of scoped item key -> [ItemField]
        val fieldsByItem = mutableMapOf<String, MutableList<ItemField>>()

        val fieldResults = executeQuery(fieldQuery, keyBindings)
        for (row in fieldResults) {
            try {
                val itemIdString = row["ItemId"] as? String ?: continue
                val manifestId = row["ManifestId"] as? String ?: continue
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

                fieldsByItem.getOrPut(scopedKey(manifestId, itemIdString)) { mutableListOf() }.add(field)
            } catch (e: Exception) {
                Log.e(TAG, "Error parsing field row", e)
            }
        }

        // Assign fields to items
        return items.map { item ->
            val fields = fieldsByItem[scopedKey(item.manifestId, item.id.toString())] ?: emptyList()
            item.copy(fields = fields)
        }
    }

    /**
     * Get the database version from the __EFMigrationsHistory table.
     *
     * @return Database version string (e.g., "1.0.0").
     */
    fun getDatabaseVersion(): String {
        val results = executeQuery(ItemQueries.GET_DATABASE_VERSION, emptyArray())

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
     * Get the first non-deleted TOTP code for an item, or null when there is none.
     * Used by the autofill service to copy the current TOTP code to the clipboard
     * when the user selects a credential to fill.
     *
     * @param itemId The UUID of the item.
     * @param manifestId The manifest the item belongs to.
     * @return The TOTP code with its RFC 6238 parameters, or null.
     */
    fun getTotpForItem(itemId: String, manifestId: String): TotpCode? {
        val results = executeQuery("${ItemQueries.GET_TOTP_CODES_FOR_ITEM} LIMIT 1", arrayOf(itemId.lowercase(), manifestId))
        val row = results.firstOrNull() ?: return null
        val secretKey = row["SecretKey"] as? String ?: return null

        return TotpCode(
            secretKey = secretKey,
            algorithm = row["Algorithm"] as? String ?: TotpCode.DEFAULT_ALGORITHM,
            digits = (row["Digits"] as? Long)?.toInt() ?: TotpCode.DEFAULT_DIGITS,
            period = (row["Period"] as? Long)?.toInt() ?: TotpCode.DEFAULT_PERIOD,
        )
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
}
