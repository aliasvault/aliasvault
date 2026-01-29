package net.aliasvault.app.vaultstore

import android.util.Log
import net.aliasvault.app.exceptions.SerializationException
import net.aliasvault.app.exceptions.VaultOperationException
import net.aliasvault.app.rustcore.VaultMergeService
import net.aliasvault.app.utils.AppInfo
import net.aliasvault.app.vaultstore.repositories.ItemRepository
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import net.aliasvault.app.vaultstore.utils.VersionComparison
import org.json.JSONArray
import org.json.JSONObject

/**
 * Handles vault synchronization with the server.
 */
class VaultSync(
    private val database: VaultDatabase,
    private val metadata: VaultMetadataManager,
    private val crypto: VaultCrypto,
    private val storageProvider: StorageProvider,
    private val itemRepository: ItemRepository,
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
     * Unified vault sync method that handles all sync scenarios:
     * 1. Server has newer vault → download (or merge if local changes exist)
     * 2. Local has changes at same revision → upload
     * 3. Both have changes → merge using LWW strategy, then upload
     * 4. Already in sync → no action needed
     *
     * This method handles race detection and retries automatically.
     * The merge logic uses the Rust core library for LWW merge.
     */
    suspend fun syncVaultWithServer(
        webApiService: net.aliasvault.app.webapi.WebApiService,
        retryCount: Int = 0,
    ): VaultSyncResult {
        val maxRetries = 3

        // Prevent infinite recursion
        if (retryCount >= maxRetries) {
            return VaultSyncResult(
                success = false,
                action = SyncAction.ERROR,
                newRevision = metadata.getVaultRevisionNumber(),
                wasOffline = metadata.getOfflineMode(),
                error = "Max sync retries reached",
            )
        }

        // Mark as syncing
        metadata.setIsSyncing(true)

        return try {
            // Step 1: Check vault version and get sync state
            val versionCheck = checkVaultVersion(webApiService)
            val serverRevision = versionCheck.serverRevision
            val syncState = versionCheck.syncState
            val mutationSeqAtStart = syncState.mutationSequence
            val isDirty = syncState.isDirty

            // Step 2: Determine sync action needed
            when {
                serverRevision > syncState.serverRevision -> {
                    // Server has newer vault
                    if (isDirty) {
                        // MERGE: Local changes + server changes
                        performMergeSync(webApiService, serverRevision, mutationSeqAtStart, retryCount)
                    } else {
                        // DOWNLOAD: No local changes, safe to overwrite
                        performDownloadSync(webApiService, serverRevision, mutationSeqAtStart, retryCount)
                    }
                }
                serverRevision == syncState.serverRevision && isDirty -> {
                    // UPLOAD: Local changes at same revision
                    performUploadSync(webApiService, mutationSeqAtStart, retryCount)
                }
                serverRevision < syncState.serverRevision -> {
                    /**
                     * Server revision DECREASED - server data loss/rollback detected.
                     * Client has more advanced revision - upload to recover server state.
                     *
                     * This will create a revision gap in server history (e.g., 95 → 101),
                     * which serves as an audit trail of the recovery event.
                     */
                    Log.w(
                        TAG,
                        "Server data loss detected! Server at rev $serverRevision, " +
                            "client at rev ${syncState.serverRevision}. Uploading to recover server state.",
                    )
                    performUploadSync(webApiService, mutationSeqAtStart, retryCount)
                }
                else -> {
                    // Already in sync
                    metadata.setIsSyncing(false)
                    VaultSyncResult(
                        success = true,
                        action = SyncAction.ALREADY_IN_SYNC,
                        newRevision = syncState.serverRevision,
                        wasOffline = false,
                        error = null,
                    )
                }
            }
        } catch (e: VaultSyncError) {
            metadata.setIsSyncing(false)
            handleSyncError(e)
        } catch (e: Exception) {
            metadata.setIsSyncing(false)
            VaultSyncResult(
                success = false,
                action = SyncAction.ERROR,
                newRevision = metadata.getVaultRevisionNumber(),
                wasOffline = metadata.getOfflineMode(),
                error = e.message ?: "Unknown error",
            )
        }
    }

    // region Sync Helpers

    /**
     * Perform download-only sync (no local changes).
     */
    private suspend fun performDownloadSync(
        webApiService: net.aliasvault.app.webapi.WebApiService,
        serverRevision: Int,
        mutationSeqAtStart: Int,
        retryCount: Int,
    ): VaultSyncResult {
        return try {
            val serverVault = fetchServerVault(webApiService)

            // Store with race detection
            val storeResult = storeEncryptedVaultWithSyncState(
                encryptedVault = serverVault.vault.blob,
                markDirty = false,
                serverRevision = serverRevision,
                expectedMutationSeq = mutationSeqAtStart,
            )

            if (!storeResult.success) {
                // Race detected - retry
                Log.d(TAG, "Race detected during download, retrying")
                metadata.setIsSyncing(false)
                return syncVaultWithServer(webApiService, retryCount + 1)
            }

            // Store vault metadata
            val vaultMetadata = net.aliasvault.app.vaultstore.models.VaultMetadata(
                publicEmailDomains = serverVault.vault.publicEmailDomainList,
                privateEmailDomains = serverVault.vault.privateEmailDomainList,
                hiddenPrivateEmailDomains = serverVault.vault.hiddenPrivateEmailDomainList,
                vaultRevisionNumber = serverRevision,
            )
            storeVaultMetadata(vaultMetadata)

            // Clear dirty flag - we just downloaded fresh from server, no local changes
            metadata.setIsDirty(false)

            // Re-unlock if was unlocked
            if (database.isVaultUnlocked()) {
                // Note: unlock requires auth methods from VaultStore
            }

            metadata.setIsSyncing(false)
            VaultSyncResult(
                success = true,
                action = SyncAction.DOWNLOADED,
                newRevision = serverRevision,
                wasOffline = false,
                error = null,
            )
        } catch (e: VaultSyncError) {
            metadata.setIsSyncing(false)
            handleSyncError(e)
        } catch (e: Exception) {
            metadata.setIsSyncing(false)
            VaultSyncResult(
                success = false,
                action = SyncAction.ERROR,
                newRevision = metadata.getVaultRevisionNumber(),
                wasOffline = metadata.getOfflineMode(),
                error = e.message ?: "Unknown error",
            )
        }
    }

    /**
     * Perform upload-only sync (local changes, no server changes).
     */
    private suspend fun performUploadSync(
        webApiService: net.aliasvault.app.webapi.WebApiService,
        mutationSeqAtStart: Int,
        retryCount: Int,
    ): VaultSyncResult {
        return try {
            val uploadResult = uploadVault(webApiService)

            when {
                uploadResult.success -> {
                    // Mark clean if no new mutations during upload
                    metadata.markVaultClean(mutationSeqAtStart, uploadResult.newRevisionNumber)
                    metadata.setIsSyncing(false)
                    VaultSyncResult(
                        success = true,
                        action = SyncAction.UPLOADED,
                        newRevision = uploadResult.newRevisionNumber,
                        wasOffline = false,
                        error = null,
                    )
                }
                uploadResult.status == 2 -> {
                    // Vault outdated - server moved forward, retry to merge
                    Log.d(TAG, "Vault outdated during upload, retrying")
                    metadata.setIsSyncing(false)
                    syncVaultWithServer(webApiService, retryCount + 1)
                }
                else -> {
                    metadata.setIsSyncing(false)
                    VaultSyncResult(
                        success = false,
                        action = SyncAction.ERROR,
                        newRevision = metadata.getVaultRevisionNumber(),
                        wasOffline = false,
                        error = uploadResult.error ?: "Upload failed",
                    )
                }
            }
        } catch (e: Exception) {
            metadata.setIsSyncing(false)
            VaultSyncResult(
                success = false,
                action = SyncAction.ERROR,
                newRevision = metadata.getVaultRevisionNumber(),
                wasOffline = metadata.getOfflineMode(),
                error = e.message ?: "Unknown error",
            )
        }
    }

    /**
     * Perform merge sync (both local and server have changes).
     */
    @Suppress("UnusedParameter") // serverRevision will be used for conflict resolution metadata in the future
    private suspend fun performMergeSync(
        webApiService: net.aliasvault.app.webapi.WebApiService,
        serverRevision: Int,
        mutationSeqAtStart: Int,
        retryCount: Int,
    ): VaultSyncResult {
        return try {
            val serverVault = fetchServerVault(webApiService)

            val localVault = database.getEncryptedDatabase()
            if (localVault.isEmpty()) {
                metadata.setIsSyncing(false)
                return VaultSyncResult(
                    success = false,
                    action = SyncAction.ERROR,
                    newRevision = metadata.getVaultRevisionNumber(),
                    wasOffline = false,
                    error = "No local vault available for merge",
                )
            }

            // Perform LWW merge using Rust core library
            val mergedVault = performLWWMerge(localVault, serverVault.vault.blob)

            // Store merged vault with race detection
            // Set serverRevision to the server's revision so prepareVault() sends correct revision when uploading
            val storeResult = storeEncryptedVaultWithSyncState(
                encryptedVault = mergedVault,
                markDirty = false,
                serverRevision = serverVault.vault.currentRevisionNumber,
                expectedMutationSeq = mutationSeqAtStart,
            )

            if (!storeResult.success) {
                // Race detected - retry
                Log.d(TAG, "Race detected during merge, retrying")
                metadata.setIsSyncing(false)
                return syncVaultWithServer(webApiService, retryCount + 1)
            }

            // Re-unlock immediately after merge to load merged vault into memory
            // This ensures prepareVault() gets correct item counts and the UI shows merged data
            if (database.isVaultUnlocked()) {
                // Note: unlock requires auth methods from VaultStore - handled there
            }

            // Upload merged vault
            val uploadResult = uploadVault(webApiService)

            when {
                uploadResult.success -> {
                    metadata.markVaultClean(mutationSeqAtStart, uploadResult.newRevisionNumber)
                    metadata.setIsSyncing(false)
                    VaultSyncResult(
                        success = true,
                        action = SyncAction.MERGED,
                        newRevision = uploadResult.newRevisionNumber,
                        wasOffline = false,
                        error = null,
                    )
                }
                uploadResult.status == 2 -> {
                    // Vault outdated again - retry
                    Log.d(TAG, "Vault outdated after merge, retrying")
                    metadata.setIsSyncing(false)
                    syncVaultWithServer(webApiService, retryCount + 1)
                }
                else -> {
                    metadata.setIsSyncing(false)
                    VaultSyncResult(
                        success = false,
                        action = SyncAction.ERROR,
                        newRevision = metadata.getVaultRevisionNumber(),
                        wasOffline = false,
                        error = uploadResult.error ?: "Upload after merge failed",
                    )
                }
            }
        } catch (e: VaultSyncError) {
            metadata.setIsSyncing(false)
            handleSyncError(e)
        } catch (e: Exception) {
            metadata.setIsSyncing(false)
            VaultSyncResult(
                success = false,
                action = SyncAction.ERROR,
                newRevision = metadata.getVaultRevisionNumber(),
                wasOffline = metadata.getOfflineMode(),
                error = e.message ?: "Unknown error",
            )
        }
    }

    /**
     * Perform Last-Write-Wins merge between local and server vaults using Rust core library.
     *
     * @param localVault Base64-encoded encrypted local vault
     * @param serverVault Base64-encoded encrypted server vault
     * @return Base64-encoded encrypted merged vault
     */
    private fun performLWWMerge(localVault: String, serverVault: String): String {
        val encryptionKey = crypto.encryptionKey
            ?: throw VaultOperationException("Encryption key not available for merge")

        return try {
            VaultMergeService.mergeVaults(
                localVaultBase64 = localVault,
                serverVaultBase64 = serverVault,
                encryptionKey = encryptionKey,
                tempDir = storageProvider.getCacheDir(),
            )
        } catch (e: VaultMergeService.VaultMergeException) {
            Log.e(TAG, "Rust merge failed: ${e.message}", e)
            throw VaultOperationException("Vault merge failed: ${e.message}", e)
        }
    }

    /**
     * Upload the vault to the server and return detailed result.
     * This is used for sync operations where race detection is needed.
     */
    private suspend fun uploadVault(webApiService: net.aliasvault.app.webapi.WebApiService): VaultUploadResult {
        val mutationSeqAtStart = metadata.getMutationSequence()

        return try {
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

            val response = try {
                webApiService.executeRequest(
                    method = "POST",
                    endpoint = "Vault",
                    body = json.toString(),
                    headers = mapOf("Content-Type" to "application/json"),
                    requiresAuth = true,
                )
            } catch (e: Exception) {
                return VaultUploadResult(
                    success = false,
                    status = -1,
                    newRevisionNumber = 0,
                    mutationSeqAtStart = mutationSeqAtStart,
                    error = "Network error: ${e.message}",
                )
            }

            if (response.statusCode != 200) {
                return VaultUploadResult(
                    success = false,
                    status = -1,
                    newRevisionNumber = 0,
                    mutationSeqAtStart = mutationSeqAtStart,
                    error = "Server returned error: ${response.statusCode}",
                )
            }

            val vaultResponse = try {
                val responseJson = JSONObject(response.body)
                VaultPostResponse(
                    status = responseJson.getInt("status"),
                    newRevisionNumber = responseJson.getInt("newRevisionNumber"),
                )
            } catch (e: Exception) {
                return VaultUploadResult(
                    success = false,
                    status = -1,
                    newRevisionNumber = 0,
                    mutationSeqAtStart = mutationSeqAtStart,
                    error = "Failed to parse response: ${e.message}",
                )
            }

            if (vaultResponse.status == 0) {
                // Success - update local revision number and clear offline mode
                metadata.setVaultRevisionNumber(vaultResponse.newRevisionNumber)
                metadata.setOfflineMode(false)
            }

            VaultUploadResult(
                success = vaultResponse.status == 0,
                status = vaultResponse.status,
                newRevisionNumber = vaultResponse.newRevisionNumber,
                mutationSeqAtStart = mutationSeqAtStart,
                error = if (vaultResponse.status != 0) "Vault upload returned status ${vaultResponse.status}" else null,
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error uploading vault", e)
            VaultUploadResult(
                success = false,
                status = -1,
                newRevisionNumber = 0,
                mutationSeqAtStart = mutationSeqAtStart,
                error = "Error uploading vault: ${e.message}",
            )
        }
    }

    /**
     * Prepare the vault for upload by assembling all metadata.
     */
    private fun prepareVault(): VaultUpload {
        val currentRevision = metadata.getVaultRevisionNumber()

        val encryptedDb = database.getEncryptedDatabase()

        val username = metadata.getUsername()
            ?: throw VaultOperationException("Username not found")

        if (!database.isVaultUnlocked()) {
            throw VaultOperationException("Vault must be unlocked to prepare for upload")
        }

        // Get all items to count them and extract private email addresses
        val items = itemRepository.getAll()

        val metadataObj = metadata.getVaultMetadataObject()
        val privateEmailDomains = metadataObj?.privateEmailDomains ?: emptyList()

        // Extract private email addresses from items using the email field
        val privateEmailAddresses = items
            .mapNotNull { it.email }
            .filter { email ->
                privateEmailDomains.any { domain ->
                    email.lowercase().endsWith("@${domain.lowercase()}")
                }
            }
            .distinct()

        val dbVersion = itemRepository.getDatabaseVersion()

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
            credentialsCount = items.size,
            currentRevisionNumber = currentRevision,
            emailAddressList = privateEmailAddresses,
            // TODO: add public RSA encryption key to payload when implementing vault creation from mobile app.
            encryptionPublicKey = "",
            updatedAt = now,
            username = username,
            version = dbVersion,
        )
    }

    /**
     * Store encrypted vault with sync state atomically.
     */
    private fun storeEncryptedVaultWithSyncState(
        encryptedVault: String,
        markDirty: Boolean,
        serverRevision: Int?,
        expectedMutationSeq: Int?,
    ): net.aliasvault.app.vaultstore.models.StoreVaultResult {
        var mutationSequence = metadata.getMutationSequence()

        // Race detection for sync operations
        if (expectedMutationSeq != null && expectedMutationSeq != mutationSequence) {
            return net.aliasvault.app.vaultstore.models.StoreVaultResult(success = false, mutationSequence = mutationSequence)
        }

        if (markDirty) {
            mutationSequence += 1
        }

        // Store vault
        database.storeEncryptedDatabase(encryptedVault)

        if (markDirty) {
            metadata.setMutationSequence(mutationSequence)
            metadata.setIsDirty(true)
        }

        if (serverRevision != null) {
            metadata.setVaultRevisionNumber(serverRevision)
        }

        return net.aliasvault.app.vaultstore.models.StoreVaultResult(success = true, mutationSequence = mutationSequence)
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

    /**
     * Handle sync errors and return appropriate result.
     */
    private fun handleSyncError(error: VaultSyncError): VaultSyncResult {
        return when (error) {
            is VaultSyncError.NetworkError,
            is VaultSyncError.ServerUnavailable,
            is VaultSyncError.Timeout,
            -> {
                metadata.setOfflineMode(true)
                VaultSyncResult(
                    success = false,
                    action = SyncAction.ERROR,
                    newRevision = metadata.getVaultRevisionNumber(),
                    wasOffline = true,
                    error = error.message,
                )
            }
            is VaultSyncError.SessionExpired,
            is VaultSyncError.AuthenticationFailed,
            is VaultSyncError.PasswordChanged,
            -> {
                VaultSyncResult(
                    success = false,
                    action = SyncAction.ERROR,
                    newRevision = metadata.getVaultRevisionNumber(),
                    wasOffline = false,
                    error = error.code,
                )
            }
            else -> {
                VaultSyncResult(
                    success = false,
                    action = SyncAction.ERROR,
                    newRevision = metadata.getVaultRevisionNumber(),
                    wasOffline = metadata.getOfflineMode(),
                    error = error.message,
                )
            }
        }
    }

    // endregion

    /**
     * Check if a new vault version is available, including sync state for merge decision.
     * This enhanced version returns sync state so the caller can decide whether to merge.
     */
    suspend fun checkVaultVersion(webApiService: net.aliasvault.app.webapi.WebApiService): VaultVersionCheckResult {
        val status = fetchAndValidateStatus(webApiService)
        metadata.setOfflineMode(false)

        val syncState = metadata.getSyncState()
        val isNewVersionAvailable = status.vaultRevision > syncState.serverRevision

        return VaultVersionCheckResult(
            isNewVersionAvailable = isNewVersionAvailable,
            newRevision = if (isNewVersionAvailable) status.vaultRevision else null,
            serverRevision = status.vaultRevision,
            syncState = syncState,
        )
    }

    /**
     * Fetch the server vault (encrypted blob).
     * Use this for merge operations where you need both local and server vaults.
     */
    suspend fun fetchServerVault(webApiService: net.aliasvault.app.webapi.WebApiService): VaultResponse {
        val vaultResponse = try {
            webApiService.executeRequest(
                method = "GET",
                endpoint = "Vault",
                body = null,
                headers = emptyMap(),
                requiresAuth = true,
            )
        } catch (e: Exception) {
            throw VaultSyncError.NetworkError(e)
        }

        if (vaultResponse.statusCode != 200) {
            if (vaultResponse.statusCode == 401) {
                throw VaultSyncError.SessionExpired()
            }
            throw VaultSyncError.ServerUnavailable(vaultResponse.statusCode)
        }

        return parseVaultResponsePublic(vaultResponse.body)
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

    private fun parseVaultResponse(body: String): InternalVaultResponse {
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

            InternalVaultResponse(
                status = json.getInt("status"),
                vault = InternalVaultData(
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

    private fun parseVaultResponsePublic(body: String): VaultResponse {
        val internal = parseVaultResponse(body)
        return VaultResponse(
            status = internal.status,
            vault = VaultData(
                username = internal.vault.username,
                blob = internal.vault.blob,
                version = internal.vault.version,
                currentRevisionNumber = internal.vault.currentRevisionNumber,
                encryptionPublicKey = internal.vault.encryptionPublicKey,
                credentialsCount = internal.vault.credentialsCount,
                emailAddressList = internal.vault.emailAddressList,
                privateEmailDomainList = internal.vault.privateEmailDomainList,
                hiddenPrivateEmailDomainList = internal.vault.hiddenPrivateEmailDomainList,
                publicEmailDomainList = internal.vault.publicEmailDomainList,
                createdAt = internal.vault.createdAt,
                updatedAt = internal.vault.updatedAt,
            ),
        )
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

    private data class InternalVaultData(
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

    private data class InternalVaultResponse(
        val status: Int,
        val vault: InternalVaultData,
    )

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
