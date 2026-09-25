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
 * @property sqliteBlobUpgradeRequired The local vault still has to walk the frozen sqlite-blob upgrade chain (pre-2.0.0); nothing was synced.
 * @property manifestMigrationRequired The local vault still has to run the manifest migration (stale schema or no account key hierarchy); nothing was synced.
 */
data class VaultSyncResult(
    val success: Boolean,
    val action: SyncAction,
    val newRevision: Int,
    val wasOffline: Boolean,
    val error: String? = null,
    val errorMessage: String? = null,
    val sqliteBlobUpgradeRequired: Boolean = false,
    val manifestMigrationRequired: Boolean = false,
)

/**
 * Result of the manifest migration the app's upgrade page drives.
 *
 * @property success Whether the migration completed locally.
 * @property pushed Whether the migrated vault reached the server; false leaves it dirty for the next sync.
 * @property error The error code, if any.
 * @property errorMessage The error message, if any.
 */
data class VaultMigrationResult(
    val success: Boolean,
    val pushed: Boolean,
    val error: String? = null,
    val errorMessage: String? = null,
)

/**
 * Result of a sharing operation of the sync engine (creating a shared manifest, inviting a member to one).
 *
 * @property success Whether the operation completed.
 * @property apiErrorCode The API error code the server refused with, which the sharing screen has words for.
 * @property vaultUpgradeRequired Whether the vault has to finish upgrading before it can be shared.
 * @property error The error code, if any.
 * @property errorMessage The error message, if any.
 */
data class VaultSharingResult(
    val success: Boolean,
    val apiErrorCode: String? = null,
    val vaultUpgradeRequired: Boolean = false,
    val error: String? = null,
    val errorMessage: String? = null,
)
