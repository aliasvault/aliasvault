package net.aliasvault.app.vaultstore.queries

/**
 * SQL query constants for per-item usage statistics.
 */
object ItemStatsQueries {
    /**
     * Create the stats row for an item on its first recorded use. Binds (manifestId, itemId, now, now).
     */
    const val INSERT_ROW = """
        INSERT OR IGNORE INTO ItemStats (
          ManifestId, Id, LastUsedAt, UseCount, LastAutofilledAt, AutofillCount,
          LastCopiedAt, CopyCount, LastPasskeyAuthAt, PasskeyAuthCount, CreatedAt, UpdatedAt, IsDeleted
        )
        VALUES (?, ?, NULL, 0, NULL, 0, NULL, 0, NULL, 0, ?, ?, 0)
    """

    /**
     * Record one use of an item, bumping the aggregate and the per-action pair. The column names come from
     * a closed set, never from caller input. IsDeleted is cleared because a use resurrects a row the pruner
     * tombstoned. Binds (now, now, now, manifestId, itemId).
     */
    fun forAction(lastColumn: String, countColumn: String): String {
        return """
            UPDATE ItemStats
            SET LastUsedAt = ?,
                UseCount = UseCount + 1,
                $lastColumn = ?,
                $countColumn = $countColumn + 1,
                UpdatedAt = ?,
                IsDeleted = 0
            WHERE ManifestId = ? AND Id = ?
        """.trimIndent()
    }
}
