package net.aliasvault.app.vaultstore

import android.util.Log
import net.aliasvault.app.exceptions.SerializationException
import net.aliasvault.app.exceptions.VaultOperationException
import net.aliasvault.app.utils.AppInfo
import net.aliasvault.app.vaultstore.utils.VersionComparison
import org.json.JSONObject

/**
 * Handles vault synchronization with the server.
 */
class VaultSync(
    private val database: VaultDatabase,
    private val metadata: VaultMetadataManager,
    private val crypto: VaultCrypto,
) {
    companion object {
        private const val TAG = "VaultSync"
    }

    // region Sync Methods

    /**
     * Check if a new vault version is available on the server.
     */
    suspend fun isNewVaultVersionAvailable(webApiService: net.aliasvault.app.webapi.WebApiService): Map<String, Any?> {
        val status = fetchAndValidateStatus(webApiService)
        metadata.setOfflineMode(false)

        val currentRevision = metadata.getVaultRevisionNumber()
        return if (status.vaultRevision > currentRevision) {
            mapOf(
                "isNewVersionAvailable" to true,
                "newRevision" to status.vaultRevision,
            )
        } else {
            mapOf(
                "isNewVersionAvailable" to false,
                "newRevision" to null,
            )
        }
    }

    /**
     * Download and store the vault from the server.
     */
    suspend fun downloadVault(webApiService: net.aliasvault.app.webapi.WebApiService, newRevision: Int): Boolean {
        try {
            downloadAndStoreVault(webApiService, newRevision)
            metadata.setOfflineMode(false)
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Error downloading vault", e)
            throw e
        }
    }

    /**
     * Sync the vault with the server.
     */
    suspend fun syncVault(webApiService: net.aliasvault.app.webapi.WebApiService): Boolean {
        val versionCheck = isNewVaultVersionAvailable(webApiService)
        val isNewVersionAvailable = versionCheck["isNewVersionAvailable"] as? Boolean ?: false
        val newRevision = versionCheck["newRevision"] as? Int

        if (isNewVersionAvailable && newRevision != null) {
            downloadVault(webApiService, newRevision)
            return true
        }

        return false
    }

    // endregion

    // region Internal Helpers

    private suspend fun fetchAndValidateStatus(webApiService: net.aliasvault.app.webapi.WebApiService): StatusResponse {
        val statusResponse = try {
            webApiService.executeRequest(
                method = "GET",
                endpoint = "Auth/status",
                body = null,
                headers = emptyMap(),
                requiresAuth = true,
            )
        } catch (e: Exception) {
            throw VaultSyncError.NetworkError(e)
        }

        if (statusResponse.statusCode != 200) {
            if (statusResponse.statusCode == 401) {
                Log.e(TAG, "Authentication failed (401) - token refresh also failed")
                throw VaultSyncError.SessionExpired()
            }
            metadata.setOfflineMode(true)
            throw VaultSyncError.ServerUnavailable(statusResponse.statusCode)
        }

        val status = try {
            val json = JSONObject(statusResponse.body)
            StatusResponse(
                clientVersionSupported = json.getBoolean("clientVersionSupported"),
                serverVersion = json.getString("serverVersion"),
                vaultRevision = json.getInt("vaultRevision"),
                srpSalt = json.getString("srpSalt"),
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode status response", e)
            Log.e(TAG, "Response body: '${statusResponse.body}'")
            throw VaultSyncError.ParseError("Failed to decode status response: ${e.message}", e)
        }

        if (!status.clientVersionSupported) {
            throw VaultSyncError.ClientVersionNotSupported()
        }

        if (!VersionComparison.isServerVersionSupported(status.serverVersion)) {
            Log.e(TAG, "Server version ${status.serverVersion} does not meet minimum requirement ${AppInfo.MIN_SERVER_VERSION}")
            throw VaultSyncError.ServerVersionNotSupported()
        }

        // Store server version in metadata
        metadata.setServerVersion(status.serverVersion)

        validateSrpSalt(status.srpSalt)
        return status
    }

    private fun validateSrpSalt(srpSalt: String) {
        val keyDerivationParams = crypto.getEncryptionKeyDerivationParams()
        if (keyDerivationParams.isEmpty()) {
            return
        }

        @Suppress("SwallowedException")
        try {
            val json = JSONObject(keyDerivationParams)
            val salt = json.optString("salt", "")
            if (srpSalt.isNotEmpty() && srpSalt != salt) {
                throw VaultSyncError.PasswordChanged()
            }
        } catch (e: VaultSyncError.PasswordChanged) {
            throw e
        } catch (e: Exception) {
            // Ignore generic parsing errors
        }
    }

    private suspend fun downloadAndStoreVault(webApiService: net.aliasvault.app.webapi.WebApiService, newRevision: Int) {
        val vaultResponse = try {
            webApiService.executeRequest(
                method = "GET",
                endpoint = "Vault",
                body = null,
                headers = emptyMap(),
                requiresAuth = true,
            )
        } catch (e: Exception) {
            throw VaultOperationException("Network error: ${e.message}", e)
        }

        if (vaultResponse.statusCode != 200) {
            if (vaultResponse.statusCode == 401) {
                throw VaultOperationException("Session expired")
            }
            throw VaultOperationException("Server unavailable: ${vaultResponse.statusCode}")
        }

        val vault = parseVaultResponse(vaultResponse.body)
        validateVaultStatus(vault.status)
        database.storeEncryptedDatabase(vault.vault.blob)
        metadata.setVaultRevisionNumber(newRevision)

        // Store vault metadata (public/private email domains)
        val vaultMetadata = net.aliasvault.app.vaultstore.models.VaultMetadata(
            publicEmailDomains = vault.vault.publicEmailDomainList,
            privateEmailDomains = vault.vault.privateEmailDomainList,
            hiddenPrivateEmailDomains = vault.vault.hiddenPrivateEmailDomainList,
            vaultRevisionNumber = newRevision,
        )
        storeVaultMetadata(vaultMetadata)

        if (database.isVaultUnlocked()) {
            // Re-unlock with new data
            // Note: This requires auth methods to be passed, handled by VaultStore
        }
    }

    /**
     * Store vault metadata as JSON string.
     */
    private fun storeVaultMetadata(vaultMetadata: net.aliasvault.app.vaultstore.models.VaultMetadata) {
        val json = JSONObject().apply {
            put("publicEmailDomains", org.json.JSONArray(vaultMetadata.publicEmailDomains))
            put("privateEmailDomains", org.json.JSONArray(vaultMetadata.privateEmailDomains))
            put("hiddenPrivateEmailDomains", org.json.JSONArray(vaultMetadata.hiddenPrivateEmailDomains))
            put("vaultRevisionNumber", vaultMetadata.vaultRevisionNumber)
        }
        metadata.storeMetadata(json.toString())
    }

    private fun parseVaultResponse(body: String): VaultResponse {
        return try {
            val json = JSONObject(body)
            val vaultJson = json.getJSONObject("vault")

            val emailList = mutableListOf<String>()
            val emailArray = vaultJson.getJSONArray("emailAddressList")
            for (i in 0 until emailArray.length()) {
                emailList.add(emailArray.getString(i))
            }

            val privateList = mutableListOf<String>()
            val privateArray = vaultJson.getJSONArray("privateEmailDomainList")
            for (i in 0 until privateArray.length()) {
                privateList.add(privateArray.getString(i))
            }

            val hiddenPrivateList = mutableListOf<String>()
            val hiddenPrivateArray = vaultJson.getJSONArray("hiddenPrivateEmailDomainList")
            for (i in 0 until hiddenPrivateArray.length()) {
                hiddenPrivateList.add(hiddenPrivateArray.getString(i))
            }

            val publicList = mutableListOf<String>()
            val publicArray = vaultJson.getJSONArray("publicEmailDomainList")
            for (i in 0 until publicArray.length()) {
                publicList.add(publicArray.getString(i))
            }

            VaultResponse(
                status = json.getInt("status"),
                vault = VaultData(
                    username = vaultJson.getString("username"),
                    blob = vaultJson.getString("blob"),
                    version = vaultJson.getString("version"),
                    currentRevisionNumber = vaultJson.getInt("currentRevisionNumber"),
                    encryptionPublicKey = vaultJson.getString("encryptionPublicKey"),
                    credentialsCount = vaultJson.getInt("credentialsCount"),
                    emailAddressList = emailList,
                    privateEmailDomainList = privateList,
                    hiddenPrivateEmailDomainList = hiddenPrivateList,
                    publicEmailDomainList = publicList,
                    createdAt = vaultJson.getString("createdAt"),
                    updatedAt = vaultJson.getString("updatedAt"),
                ),
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode vault response", e)
            throw SerializationException("Failed to decode vault response: ${e.message}", e)
        }
    }

    private fun validateVaultStatus(status: Int) {
        when (status) {
            0 -> return
            1 -> throw VaultOperationException("Vault merge required")
            2 -> throw VaultOperationException("Vault outdated")
            else -> throw VaultOperationException("Unknown vault status: $status")
        }
    }

    // endregion

    // region Data Models

    private data class StatusResponse(
        val clientVersionSupported: Boolean,
        val serverVersion: String,
        val vaultRevision: Int,
        val srpSalt: String,
    )

    private data class VaultData(
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

    private data class VaultResponse(
        val status: Int,
        val vault: VaultData,
    )

    // endregion
}
