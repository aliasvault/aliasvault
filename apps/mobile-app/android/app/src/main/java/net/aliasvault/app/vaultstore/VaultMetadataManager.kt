package net.aliasvault.app.vaultstore

import android.util.Log
import net.aliasvault.app.vaultstore.models.VaultMetadata
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import net.aliasvault.app.vaultstore.utils.VersionComparison
import org.json.JSONArray
import org.json.JSONObject

/**
 * Handles metadata operations for the vault.
 */
class VaultMetadataManager(
    private val storageProvider: StorageProvider,
) {
    companion object {
        private const val TAG = "VaultMetadata"
    }

    // region Metadata Storage

    /**
     * Store the metadata in the storage provider.
     */
    fun storeMetadata(metadata: String) {
        storageProvider.setMetadata(metadata)
    }

    /**
     * Get the metadata from the storage provider.
     */
    fun getMetadata(): String {
        return storageProvider.getMetadata()
    }

    // endregion

    // region Vault Revision Number

    /**
     * Set the vault revision number.
     */
    fun setVaultRevisionNumber(revisionNumber: Int) {
        val metadata = getVaultMetadataObject() ?: VaultMetadata()
        val updatedMetadata = metadata.copy(vaultRevisionNumber = revisionNumber)
        storeMetadata(
            JSONObject().apply {
                put("publicEmailDomains", JSONArray(updatedMetadata.publicEmailDomains))
                put("privateEmailDomains", JSONArray(updatedMetadata.privateEmailDomains))
                put("hiddenPrivateEmailDomains", JSONArray(updatedMetadata.hiddenPrivateEmailDomains))
                put("vaultRevisionNumber", updatedMetadata.vaultRevisionNumber)
            }.toString(),
        )
    }

    /**
     * Get the vault revision number.
     */
    fun getVaultRevisionNumber(): Int {
        return getVaultMetadataObject()?.vaultRevisionNumber ?: 0
    }

    // endregion

    // region Username Management

    /**
     * Set the username.
     */
    fun setUsername(username: String) {
        storageProvider.setUsername(username)
    }

    /**
     * Get the username.
     */
    fun getUsername(): String? {
        return storageProvider.getUsername()
    }

    /**
     * Clear the username.
     */
    fun clearUsername() {
        storageProvider.clearUsername()
    }

    // endregion

    // region Offline Mode Management

    /**
     * Set offline mode flag.
     */
    fun setOfflineMode(isOffline: Boolean) {
        storageProvider.setOfflineMode(isOffline)
    }

    /**
     * Get offline mode flag.
     */
    fun getOfflineMode(): Boolean {
        return storageProvider.getOfflineMode()
    }

    // endregion

    // region Server Version Management

    /**
     * Set the server API version.
     */
    fun setServerVersion(version: String) {
        storageProvider.setServerVersion(version)
    }

    /**
     * Get the server API version.
     */
    fun getServerVersion(): String? {
        return storageProvider.getServerVersion()
    }

    /**
     * Clear the server version.
     */
    fun clearServerVersion() {
        storageProvider.clearServerVersion()
    }

    /**
     * Check if the stored server version is greater than or equal to the specified version.
     * @param targetVersion The version to compare against (e.g., "0.25.0")
     * @return true if stored server version >= targetVersion, false if server version not available or less than target
     */
    fun isServerVersionGreaterThanOrEqualTo(targetVersion: String): Boolean {
        val serverVersion = getServerVersion() ?: return false // No server version stored yet
        return VersionComparison.isGreaterThanOrEqualTo(serverVersion, targetVersion)
    }

    // endregion

    // region Sync State Management

    /**
     * Set the dirty flag indicating local changes need to be synced.
     */
    fun setIsDirty(isDirty: Boolean) {
        storageProvider.setIsDirty(isDirty)
    }

    /**
     * Get the dirty flag.
     */
    fun getIsDirty(): Boolean {
        return storageProvider.getIsDirty()
    }

    /**
     * Get the current mutation sequence number.
     */
    fun getMutationSequence(): Int {
        return storageProvider.getMutationSequence()
    }

    /**
     * Set the mutation sequence number.
     */
    fun setMutationSequence(sequence: Int) {
        storageProvider.setMutationSequence(sequence)
    }

    /**
     * Increment the mutation sequence and return the new value.
     */
    fun incrementMutationSequence(): Int {
        val current = getMutationSequence()
        val newValue = current + 1
        setMutationSequence(newValue)
        return newValue
    }

    /**
     * Set the syncing flag.
     */
    fun setIsSyncing(isSyncing: Boolean) {
        storageProvider.setIsSyncing(isSyncing)
    }

    /**
     * Get the syncing flag.
     */
    fun getIsSyncing(): Boolean {
        return storageProvider.getIsSyncing()
    }

    /**
     * Get the complete sync state.
     */
    fun getSyncState(): SyncState {
        return SyncState(
            isDirty = getIsDirty(),
            mutationSequence = getMutationSequence(),
            serverRevision = getVaultRevisionNumber(),
            isSyncing = getIsSyncing(),
        )
    }

    /**
     * Mark the vault as clean after successful sync.
     * Only clears dirty flag if no mutations happened during sync.
     *
     * @param mutationSeqAtStart The mutation sequence when sync started
     * @param newServerRevision The new server revision after successful upload
     * @return Whether the dirty flag was cleared
     */
    fun markVaultClean(mutationSeqAtStart: Int, newServerRevision: Int): Boolean {
        val currentMutationSeq = getMutationSequence()

        // Always update server revision
        setVaultRevisionNumber(newServerRevision)

        if (currentMutationSeq == mutationSeqAtStart) {
            // No mutations during sync - safe to mark as clean
            setIsDirty(false)
            return true
        }

        // Mutations happened during sync - keep dirty
        return false
    }

    /**
     * Clear all sync state (used on logout).
     */
    fun clearSyncState() {
        storageProvider.clearSyncState()
    }

    // endregion

    // region Internal Helpers

    /**
     * Get the vault metadata object.
     */
    fun getVaultMetadataObject(): VaultMetadata? {
        val metadataJson = getMetadata()
        if (metadataJson.isBlank()) {
            return null
        }
        return try {
            val json = JSONObject(metadataJson)
            VaultMetadata(
                publicEmailDomains = json.optJSONArray("publicEmailDomains")?.let { array ->
                    List(array.length()) { i -> array.getString(i) }
                } ?: emptyList(),
                privateEmailDomains = json.optJSONArray("privateEmailDomains")?.let { array ->
                    List(array.length()) { i -> array.getString(i) }
                } ?: emptyList(),
                hiddenPrivateEmailDomains = json.optJSONArray("hiddenPrivateEmailDomains")?.let { array ->
                    List(array.length()) { i -> array.getString(i) }
                } ?: emptyList(),
                vaultRevisionNumber = json.optInt("vaultRevisionNumber", 0),
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error parsing vault metadata", e)
            null
        }
    }

    // endregion
}
