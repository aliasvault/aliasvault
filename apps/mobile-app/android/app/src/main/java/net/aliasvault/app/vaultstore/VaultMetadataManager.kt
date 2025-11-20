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
