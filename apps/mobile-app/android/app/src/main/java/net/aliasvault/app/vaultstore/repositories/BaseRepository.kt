package net.aliasvault.app.vaultstore.repositories

import net.aliasvault.app.utils.DateHelpers
import net.aliasvault.app.vaultstore.AppError
import net.aliasvault.app.vaultstore.VaultDatabase
import java.util.UUID

/**
 * Base repository class with common database operations.
 */
open class BaseRepository(
    /** The database component used for executing queries. */
    protected val database: VaultDatabase,
) {
    /**
     * The manifest new rows outside any folder or item are stamped with: the personal manifest. Rows inside a
     * folder or item take that parent's manifest through the SQL instead. Throws when no manifest has been
     * recorded yet, since an unstamped row would make every later push of the vault fail.
     */
    protected fun activeManifestId(): String {
        return database.getPersonalManifestId() ?: throw AppError.ManifestNotRecorded()
    }

    /**
     * The manifest a manifest-scoped row belongs to, looked up from the row itself: the personal manifest when
     * the row exists there, else the lowest manifest id holding it. Null when no such row exists.
     */
    protected fun resolveRowManifestId(table: String, id: String, column: String = "Id"): String? {
        val rows = executeQuery("SELECT ManifestId FROM $table WHERE $column = ? ORDER BY ManifestId", arrayOf(id))
        val manifestIds = rows.mapNotNull { it["ManifestId"] as? String }
        if (manifestIds.isEmpty()) return null
        val personal = database.getPersonalManifestId()
        return manifestIds.firstOrNull { it == personal } ?: manifestIds.first()
    }

    /**
     * The grouping key of a manifest-scoped row, for joining rows of one query to rows of another in memory.
     */
    protected fun scopedKey(manifestId: String, id: String): String {
        return "${manifestId.lowercase()}${id.lowercase()}"
    }

    // MARK: - Transaction Helpers

    /**
     * Execute a function within a transaction. The commit persists the vault and marks it dirty, so every
     * repository write reaches the next sync.
     * @param operation The function to execute within the transaction
     * @return The result of the function
     */
    fun <T> withTransaction(operation: () -> T): T {
        database.beginTransaction()
        return try {
            val result = operation()
            database.commitTransaction()
            result
        } catch (e: Exception) {
            database.rollbackTransaction()
            throw e
        }
    }

    // MARK: - Utility Methods

    /**
     * Generate a new id.
     * @return A new UUID string
     */
    fun generateId(): String {
        return UUID.randomUUID().toString()
    }

    /**
     * Get the current timestamp in the standard format.
     * @return Current timestamp string
     */
    fun now(): String {
        return DateHelpers.now()
    }

    // MARK: - Database Operation Helpers

    /**
     * Execute a SELECT query on the database.
     */
    protected fun executeQuery(query: String, params: Array<Any?>): List<Map<String, Any?>> {
        return database.query(query, params.toList())
    }

    /**
     * Execute an UPDATE, INSERT, or DELETE query on the database.
     */
    protected fun executeUpdate(query: String, params: Array<Any?>): Int {
        return database.execute(query, params.toList())
    }
}
