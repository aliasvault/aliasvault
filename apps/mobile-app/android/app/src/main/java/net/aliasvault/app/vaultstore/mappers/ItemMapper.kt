package net.aliasvault.app.vaultstore.mappers

import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.models.BuiltinLogos
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.ItemField
import net.aliasvault.app.vaultstore.repositories.scopedKey
import java.util.Calendar
import java.util.Date
import java.util.TimeZone
import java.util.UUID

/**
 * Raw item row from a database query.
 *
 * @property id The item id.
 * @property manifestId The manifest the item lives in.
 * @property name The item name.
 * @property itemType The item type.
 * @property folderId The folder the item is in, if any.
 * @property logo The logo bytes, resolved from the built-in catalog when the logo is built in.
 * @property hasPasskey Whether the item has a live passkey.
 * @property hasAttachment Whether the item has a live attachment.
 * @property hasTotp Whether the item has a live TOTP code.
 * @property createdAt Creation timestamp text.
 * @property updatedAt Update timestamp text.
 */
data class ItemRow(
    val id: String,
    val manifestId: String,
    val name: String?,
    val itemType: String,
    val folderId: String?,
    val logo: ByteArray?,
    val hasPasskey: Boolean,
    val hasAttachment: Boolean,
    val hasTotp: Boolean,
    val createdAt: String,
    val updatedAt: String,
) {
    /**
     * The key this item's child rows are grouped under (see `scopedKey`).
     */
    val scopedItemKey: String
        get() = scopedKey(manifestId, id)

    companion object {
        private const val LOGO_KIND_BUILTIN = "builtin"

        /**
         * Read a row from a query result, or null when a required column is missing.
         */
        fun fromRow(row: Map<String, Any?>): ItemRow? {
            return ItemRow(
                id = row["Id"] as? String ?: return null,
                manifestId = row["ManifestId"] as? String ?: return null,
                name = row["Name"] as? String,
                itemType = row["ItemType"] as? String ?: return null,
                folderId = row["FolderId"] as? String,
                logo = resolveLogo(row),
                hasPasskey = (row["HasPasskey"] as? Long) == 1L,
                hasAttachment = (row["HasAttachment"] as? Long) == 1L,
                hasTotp = (row["HasTotp"] as? Long) == 1L,
                createdAt = row["CreatedAt"] as? String ?: "",
                updatedAt = row["UpdatedAt"] as? String ?: "",
            )
        }

        /**
         * The bytes an item's logo is drawn from. A built-in logo carries none: it is drawn from the shared catalog, keyed by its Source.
         */
        private fun resolveLogo(row: Map<String, Any?>): ByteArray? {
            if (row["LogoKind"] as? String == LOGO_KIND_BUILTIN) {
                return (row["LogoSource"] as? String)?.let { BuiltinLogos.svgFor(it) }?.toByteArray(Charsets.UTF_8)
            }
            return row["Logo"] as? ByteArray
        }
    }
}

/**
 * Maps item rows to Item objects.
 * Other platform implementations: ItemMapper.ts (core/client), ItemMapper.swift (iOS).
 */
object ItemMapper {
    /**
     * The date an unparseable timestamp falls back to.
     */
    val MIN_DATE: Date = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
        set(Calendar.YEAR, 1)
        set(Calendar.MONTH, Calendar.JANUARY)
        set(Calendar.DAY_OF_MONTH, 1)
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }.time

    /**
     * Map one item row to an Item with its fields and folder path.
     */
    fun mapRow(row: ItemRow, fields: List<ItemField> = emptyList(), folderPath: List<String>? = null): Item {
        return Item(
            id = UUID.fromString(row.id),
            manifestId = row.manifestId,
            name = row.name,
            itemType = row.itemType,
            logo = row.logo,
            folderId = row.folderId?.let { UUID.fromString(it) },
            folderPath = folderPath,
            fields = fields,
            hasPasskey = row.hasPasskey,
            hasAttachment = row.hasAttachment,
            hasTotp = row.hasTotp,
            createdAt = DateHelpers.parseDateString(row.createdAt) ?: MIN_DATE,
            updatedAt = DateHelpers.parseDateString(row.updatedAt) ?: MIN_DATE,
        )
    }

    /**
     * Map item rows to Items, joining the fields and folder paths by scoped key.
     */
    fun mapRows(rows: List<ItemRow>, fieldsByItem: Map<String, List<ItemField>>, folderPathsByFolderKey: Map<String, List<String>> = emptyMap()): List<Item> {
        return rows.map { row ->
            val fields = fieldsByItem[row.scopedItemKey] ?: emptyList()
            val folderPath = row.folderId?.let { folderPathsByFolderKey[scopedKey(row.manifestId, it)] }
            mapRow(row, fields, folderPath)
        }
    }
}
