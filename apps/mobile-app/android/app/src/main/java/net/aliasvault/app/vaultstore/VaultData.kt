package net.aliasvault.app.vaultstore

/**
 * Outcome of a status check: whether the server holds newer state than this device.
 *
 * @property isNewVersionAvailable Whether the server holds newer state.
 * @property syncState The current sync state of the vault.
 */
data class VaultVersionCheckResult(
    val isNewVersionAvailable: Boolean,
    val syncState: net.aliasvault.app.vaultstore.models.SyncState,
)

/**
 * What a sync did.
 *
 * @property value The string value of the sync action.
 */
enum class SyncAction(val value: String) {
    UPLOADED("uploaded"),
    DOWNLOADED("downloaded"),
    MERGED("merged"),
    ALREADY_IN_SYNC("already_in_sync"),
    ERROR("error"),
}

/**
 * Result of a full vault sync.
 *
 * @property success Whether the sync was successful.
 * @property action The action taken during sync.
 * @property newRevision The vault revision after the sync.
 * @property wasOffline Whether the sync ran offline.
 * @property error The error code, if any.
 * @property errorMessage The error message, if any.
 */
data class VaultSyncResult(
    val success: Boolean,
    val action: SyncAction,
    val newRevision: Int,
    val wasOffline: Boolean,
    val error: String? = null,
    val errorMessage: String? = null,
)
