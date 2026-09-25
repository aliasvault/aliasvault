package net.aliasvault.app.vaultstore.repositories

import net.aliasvault.app.vaultstore.VaultDatabase
import net.aliasvault.app.vaultstore.models.VaultDataBucketCategory
import net.aliasvault.app.vaultstore.queries.ItemStatsQueries

/**
 * The actions whose use of an item is recorded, each with its own timestamp + counter pair.
 */
enum class ItemUsageAction(
    /** The per-action timestamp column. */
    val lastColumn: String,
    /** The per-action counter column. */
    val countColumn: String,
) {
    /** The item was filled into a form. */
    AUTOFILL("LastAutofilledAt", "AutofillCount"),

    /** A value of the item was copied. */
    COPY("LastCopiedAt", "CopyCount"),

    /** The item's passkey signed an assertion. */
    PASSKEY("LastPasskeyAuthAt", "PasskeyAuthCount"),
}

/**
 * Repository for per-item usage statistics.
 */
class ItemStatsRepository(database: VaultDatabase) : BaseRepository(database) {
    /**
     * Record one use of an item, in its own transaction so the vault is persisted and marked dirty.
     * @param itemId The item that was used
     * @param manifestId The manifest the item belongs to
     * @param action What the user did with it
     */
    fun recordUsage(itemId: String, manifestId: String, action: ItemUsageAction) {
        // Usage statistics live in their own data bucket which should be pushed without a full manifest write.
        withTransaction(VaultDataBucketCategory.STATS) {
            val now = now()
            val id = itemId.lowercase()
            executeUpdate(ItemStatsQueries.INSERT_ROW, arrayOf(manifestId, id, now, now))
            executeUpdate(ItemStatsQueries.forAction(action.lastColumn, action.countColumn), arrayOf(now, now, now, manifestId, id))
        }
    }
}
