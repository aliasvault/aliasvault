package net.aliasvault.app.vaultstore

import android.util.Log
import net.aliasvault.app.exceptions.SerializationException
import net.aliasvault.app.exceptions.VaultOperationException
import org.json.JSONArray
import org.json.JSONObject

/**
 * Handles vault mutation operations (uploading changes to server).
 */
class VaultMutate(
    private val database: VaultDatabase,
    private val query: VaultQuery,
    private val metadata: VaultMetadataManager,
) {
    companion object {
        private const val TAG = "VaultMutate"
    }

    // region Vault Mutation

    /**
     * Execute a vault mutation operation.
     */
    suspend fun mutateVault(webApiService: net.aliasvault.app.webapi.WebApiService): Boolean {
        try {
            val vault = prepareVault()

            val json = JSONObject()
            json.put("blob", vault.blob)
            json.put("createdAt", vault.createdAt)
            json.put("credentialsCount", vault.credentialsCount)
            json.put("currentRevisionNumber", vault.currentRevisionNumber)
            json.put("emailAddressList", JSONArray(vault.emailAddressList))
            json.put("encryptionPublicKey", vault.encryptionPublicKey)
            json.put("updatedAt", vault.updatedAt)
            json.put("username", vault.username)
            json.put("version", vault.version)

            val response = webApiService.executeRequest(
                method = "POST",
                endpoint = "Vault",
                body = json.toString(),
                headers = mapOf("Content-Type" to "application/json"),
                requiresAuth = true,
            )

            if (response.statusCode != 200) {
                Log.e(TAG, "Server rejected vault upload with status ${response.statusCode}")
                throw VaultOperationException("Server returned error: ${response.statusCode}")
            }

            val vaultResponse = try {
                val responseJson = JSONObject(response.body)
                VaultPostResponse(
                    status = responseJson.getInt("status"),
                    newRevisionNumber = responseJson.getInt("newRevisionNumber"),
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse vault upload response", e)
                throw SerializationException("Failed to parse vault upload response: ${e.message}", e)
            }

            when (vaultResponse.status) {
                0 -> {
                    metadata.setVaultRevisionNumber(vaultResponse.newRevisionNumber)
                    metadata.setOfflineMode(false)
                    return true
                }
                1 -> throw VaultOperationException("Vault merge required")
                2 -> throw VaultOperationException("Vault is outdated, please sync first")
                else -> throw VaultOperationException("Failed to upload vault")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error mutating vault", e)
            throw e
        }
    }

    // endregion

    // region Internal Helpers

    private fun prepareVault(): VaultUpload {
        val currentRevision = metadata.getVaultRevisionNumber()

        val encryptedDb = database.getEncryptedDatabase()

        val username = metadata.getUsername()
            ?: throw VaultOperationException("Username not found")

        if (!database.isVaultUnlocked()) {
            throw VaultOperationException("Vault must be unlocked to prepare for upload")
        }

        val credentials = query.getAllCredentials()

        val metadataObj = metadata.getVaultMetadataObject()
        val privateEmailDomains = metadataObj?.privateEmailDomains ?: emptyList()

        val privateEmailAddresses = credentials
            .mapNotNull { it.alias?.email }
            .filter { email ->
                privateEmailDomains.any { domain ->
                    email.lowercase().endsWith("@${domain.lowercase()}")
                }
            }
            .distinct()

        val dbVersion = query.getDatabaseVersion()

        @Suppress("SwallowedException")
        val version = try {
            // Try to get version from storage provider context
            val context = database.javaClass.getDeclaredField("storageProvider")
                .get(database) as? net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider
            val pm = context?.javaClass?.getDeclaredField("context")?.get(context)
                as? android.content.Context
            pm?.packageManager?.getPackageInfo(pm.packageName, 0)?.versionName ?: "0.0.0"
        } catch (e: Exception) {
            "0.0.0"
        }

        val dateFormat = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
        dateFormat.timeZone = java.util.TimeZone.getTimeZone("UTC")
        val now = dateFormat.format(java.util.Date())

        return VaultUpload(
            blob = encryptedDb,
            createdAt = now,
            credentialsCount = credentials.size,
            currentRevisionNumber = currentRevision,
            emailAddressList = privateEmailAddresses,
            // TODO: add public RSA encryption key to payload when implementing vault creation from mobile app. Currently only web app does this.
            encryptionPublicKey = "",
            updatedAt = now,
            username = username,
            version = dbVersion,
        )
    }

    // endregion

    // region Data Models

    private data class VaultUpload(
        val blob: String,
        val createdAt: String,
        val credentialsCount: Int,
        val currentRevisionNumber: Int,
        val emailAddressList: List<String>,
        val encryptionPublicKey: String,
        val updatedAt: String,
        val username: String,
        val version: String,
    )

    private data class VaultPostResponse(
        val status: Int,
        val newRevisionNumber: Int,
    )

    // endregion
}
