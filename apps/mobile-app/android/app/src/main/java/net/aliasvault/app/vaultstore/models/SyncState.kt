package net.aliasvault.app.vaultstore.models

/**
 * Sync state for offline sync and race detection.
 */
data class SyncState(
    /**
     * True if local vault has unsynced changes.
     */
    val isDirty: Boolean = false,

    /**
     * Counter that increments on each local mutation.
     * Used for race detection during sync operations.
     */
    val mutationSequence: Int = 0,

    /**
     * The last synced server revision number.
     */
    val serverRevision: Int = 0,

    /**
     * True if a sync operation is currently in progress.
     */
    val isSyncing: Boolean = false,
)
