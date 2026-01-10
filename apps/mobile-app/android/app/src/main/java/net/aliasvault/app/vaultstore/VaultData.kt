package net.aliasvault.app.vaultstore

/**
 * Vault data from API.
 *
 * @property username The username associated with the vault.
 * @property blob The encrypted vault blob.
 * @property version The vault version.
 * @property currentRevisionNumber The current revision number of the vault.
 * @property encryptionPublicKey The public key used for encryption.
 * @property credentialsCount The number of credentials in the vault.
 * @property emailAddressList The list of email addresses.
 * @property privateEmailDomainList The list of private email domains.
 * @property hiddenPrivateEmailDomainList The list of hidden private email domains.
 * @property publicEmailDomainList The list of public email domains.
 * @property createdAt The timestamp when the vault was created.
 * @property updatedAt The timestamp when the vault was last updated.
 */
data class VaultData(
    val username: String,
    val blob: String,
    val version: String,
    val currentRevisionNumber: Int,
    val encryptionPublicKey: String,
    val credentialsCount: Int,
    val emailAddressList: List<String>,
    val privateEmailDomainList: List<String>,
    val hiddenPrivateEmailDomainList: List<String>,
    val publicEmailDomainList: List<String>,
    val createdAt: String,
    val updatedAt: String,
)

/**
 * Vault response from Vault GET endpoint.
 *
 * @property status The HTTP status code of the response.
 * @property vault The vault data returned from the server.
 */
data class VaultResponse(
    val status: Int,
    val vault: VaultData,
)

/**
 * Result of checking for new vault version.
 *
 * @property isNewVersionAvailable Whether a new version is available on the server.
 * @property newRevision The new revision number if available.
 * @property serverRevision The current revision number on the server.
 * @property syncState The current sync state of the vault.
 */
data class VaultVersionCheckResult(
    val isNewVersionAvailable: Boolean,
    val newRevision: Int?,
    val serverRevision: Int,
    val syncState: net.aliasvault.app.vaultstore.models.SyncState,
)

/**
 * Result of vault upload.
 *
 * @property success Whether the upload was successful.
 * @property status The HTTP status code of the upload response.
 * @property newRevisionNumber The new revision number after upload.
 * @property mutationSeqAtStart The mutation sequence number at the start of upload.
 * @property error The error message if upload failed.
 */
data class VaultUploadResult(
    val success: Boolean,
    val status: Int,
    val newRevisionNumber: Int,
    val mutationSeqAtStart: Int,
    val error: String? = null,
)

/**
 * Action taken during sync.
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
 * Result of syncVaultWithServer operation.
 *
 * @property success Whether the sync was successful.
 * @property action The action taken during sync.
 * @property newRevision The new revision number after sync.
 * @property wasOffline Whether the sync occurred while offline.
 * @property error The error message if sync failed.
 */
data class VaultSyncResult(
    val success: Boolean,
    val action: SyncAction,
    val newRevision: Int,
    val wasOffline: Boolean,
    val error: String? = null,
)
