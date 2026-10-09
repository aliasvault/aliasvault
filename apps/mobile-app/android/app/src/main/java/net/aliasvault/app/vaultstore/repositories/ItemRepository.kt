package net.aliasvault.app.vaultstore.repositories

import android.util.Log
import net.aliasvault.app.vaultstore.VaultDatabase
import net.aliasvault.app.vaultstore.mappers.FieldMapper
import net.aliasvault.app.vaultstore.mappers.FieldRow
import net.aliasvault.app.vaultstore.mappers.ItemMapper
import net.aliasvault.app.vaultstore.mappers.ItemRow
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.TotpCode
import net.aliasvault.app.vaultstore.queries.ItemQueries
import net.aliasvault.app.vaultstore.utils.FolderUtils
import java.util.UUID

/**
 * Repository for the item reads the autofill service needs.
 * Other platform implementations: ItemRepository.ts (core/client), ItemRepository.swift (iOS).
 */
class ItemRepository(database: VaultDatabase) : BaseRepository(database) {
    companion object {
        private const val TAG = "ItemRepository"
    }

    // MARK: - Read Operations

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
    fun getAll(): List<Item> {
        val itemRows = executeQuery(ItemQueries.GET_ALL_ACTIVE, emptyArray()).mapNotNull { ItemRow.fromRow(it) }
        if (itemRows.isEmpty()) {
            return emptyList()
        }

        // Fields are matched on the whole (ManifestId, Id) key, bound as one pair per item.
        val keyBindings = itemRows.flatMap { listOf<Any?>(it.manifestId, it.id.lowercase()) }.toTypedArray()
        val fieldRows = executeQuery(ItemQueries.getFieldValuesForItems(itemRows.size), keyBindings).mapNotNull { FieldRow.fromRow(it) }
        val fieldsByItem = FieldMapper.processFieldRows(fieldRows)
        val folderPaths = buildFolderPaths()

        return ItemMapper.mapRows(itemRows, fieldsByItem, folderPaths)
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
}
