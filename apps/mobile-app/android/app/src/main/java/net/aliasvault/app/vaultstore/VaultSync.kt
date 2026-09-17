package net.aliasvault.app.vaultstore

import android.util.Log
import net.aliasvault.app.vaultstore.models.VaultMetadata
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import net.aliasvault.app.webapi.WebApiService
import org.json.JSONArray
import org.json.JSONObject

/**
 * The vault sync wrapper: one method per engine operation, adoption of what the engine reported, and the mapping of
 * its failures into the native error. The driver below it is VaultSyncEngine, which turns the Rust engine's
 * commands into host actions.
 *
 * When updating this logic, make sure to update the same logic on the other platforms:
 * - core/client/src/sync/VaultSync.ts (shared core client for web apps)
 * - apps/mobile-app/ios/VaultStoreKit/Services/VaultSync.swift
 * - apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/VaultSync.kt (this file)
 */
class VaultSync(
    private val vaultStore: VaultStore,
    private val storageProvider: StorageProvider,
) {
    companion object {
        private const val TAG = "VaultSync"
    }

    /**
     * Full vault sync: status check, then pull (and merge) or push as the server and local revisions decide. Never throws.
     */
    suspend fun syncVaultWithServer(webApiService: WebApiService): VaultSyncResult {
        val startNanos = System.nanoTime()
        val metadata = vaultStore.metadata
        metadata.setIsSyncing(true)
        try {
            val wasDirty = metadata.getIsDirty()
            val result = try {
                run("fullSync", webApiService)
            } catch (e: AppError) {
                return failedSync(e, metadata.getOfflineMode())
            }

            val wasOffline = result.optBoolean("wasOffline", false)
            if (!result.optBoolean("success", false)) {
                return failedSync(syncError(result), wasOffline)
            }
            if (wasOffline) {
                val code = AppError.NetworkError(IllegalStateException("offline")).code
                return VaultSyncResult(false, SyncAction.ERROR, metadata.getVaultRevisionNumber(), true, code)
            }

            /*
             * A vault that still has to be upgraded is reported, never migrated here: the app routes it to the upgrade
             * page, which asks first when the migration signs out every other pre-format client (see migrateVaultManifest).
             */
            val hasNewVault = result.optBoolean("hasNewVault", false)
            val action = when {
                hasNewVault && wasDirty -> SyncAction.MERGED
                hasNewVault -> SyncAction.DOWNLOADED
                wasDirty -> SyncAction.UPLOADED
                else -> SyncAction.ALREADY_IN_SYNC
            }
            return VaultSyncResult(
                success = true,
                action = action,
                newRevision = metadata.getVaultRevisionNumber(),
                wasOffline = false,
                sqliteBlobUpgradeRequired = result.optBoolean("sqliteBlobUpgradeRequired", false),
                manifestMigrationRequired = result.optBoolean("manifestMigrationRequired", false),
            )
        } finally {
            metadata.setIsSyncing(false)
            Log.d(TAG, "Sync finished in ${VaultSyncRunLog.elapsedMsSince(startNanos)}ms")
        }
    }

    /**
     * One status call: whether the server holds newer state than this device.
     */
    suspend fun checkVaultVersion(webApiService: WebApiService): VaultVersionCheckResult {
        val result = run("statusCheck", webApiService)
        if (result.optBoolean("isOffline", false)) {
            vaultStore.metadata.setOfflineMode(true)
            throw AppError.ServerUnavailable(0)
        }
        if (result.optBoolean("requiresLogout", false) || !result.optBoolean("success", false)) {
            throw syncError(result)
        }
        vaultStore.metadata.setOfflineMode(false)
        return VaultVersionCheckResult(result.optBoolean("hasNewerVault", false), vaultStore.getSyncState())
    }

    /**
     * Resolve the vault key right after login: the account's key chain is opened with the unlock key
     * and cached as-is. The session then opens from that chain like every later unlock, and the keystore keeps the
     * unlock key. Returns the vault key (base64).
     */
    suspend fun resolveVaultKey(webApiService: WebApiService, derivedKeyBase64: String): String {
        val result = run("resolveVaultKey", webApiService, encryptionKey = derivedKeyBase64)
        if (!result.optBoolean("success", false)) {
            throw syncError(result)
        }
        vaultStore.storeUnlockKey(derivedKeyBase64)
        return vaultStore.getEncryptionKeyBase64() ?: derivedKeyBase64
    }

    /**
     * Classify the pending manifest migration as the engine sees it: `none`, `schema-rebuild` (runs unattended) or
     * `storage-format-upgrade` (the app asks first). A vault still on the sqlite-blob chain classifies as `none`.
     */
    suspend fun getVaultMigrationStatus(webApiService: WebApiService): String {
        val status = run("migrationStatus", webApiService)
        return status.optString("kind").takeIf { it.isNotEmpty() } ?: "storage-format-upgrade"
    }

    /**
     * Bring the local vault onto the current storage model (a schema rebuild after an app update, or the one-time
     * account-key upgrade of a legacy vault) and push it. Driven by the app's upgrade page only: a sync never runs
     * it on its own, because the storage format move signs out every other client that predates the format. Never throws.
     */
    suspend fun migrateVaultManifest(webApiService: WebApiService): VaultMigrationResult {
        val result = try {
            run("migrateManifest", webApiService)
        } catch (e: AppError) {
            return failedMigration(e)
        }
        if (!result.optBoolean("success", false)) {
            return failedMigration(syncError(result))
        }
        val pushed = result.optBoolean("pushed", false)
        Log.i(TAG, "Manifest migration complete: pushed=$pushed")
        return VaultMigrationResult(true, pushed)
    }

    /**
     * Push the pending local changes (after a native mutation such as an autofill link or a passkey creation).
     */
    suspend fun mutateVault(webApiService: WebApiService): Boolean {
        val result = syncVaultWithServer(webApiService)
        if (!result.success && !result.wasOffline) {
            throw AppError.VaultUploadFailed(result.errorMessage ?: result.error ?: "Vault sync failed")
        }
        return result.success
    }

    /**
     * Run one engine operation and adopt what it reported. A driver failure surfaces as the native error.
     */
    @Suppress("TooGenericExceptionCaught")
    private suspend fun run(operation: String, webApiService: WebApiService, encryptionKey: String? = null): JSONObject {
        val result = try {
            VaultSyncEngine(vaultStore, storageProvider, webApiService).run(operation, encryptionKey = encryptionKey)
        } catch (e: Exception) {
            throw driverError(e)
        }
        adoptSyncResult(result)
        return result
    }

    /**
     * Persist what the engine reported: server version, offline mode, session values it changed, and the email
     * routing a pulled vault came with. Capabilities are not stored: the mobile app has no capability gate yet.
     */
    private fun adoptSyncResult(result: JSONObject) {
        result.optString("serverVersion").takeIf { it.isNotEmpty() }?.let { vaultStore.metadata.setServerVersion(it) }
        if (result.has("isOfflineMode")) {
            vaultStore.metadata.setOfflineMode(result.optBoolean("isOfflineMode", false))
        }
        result.optJSONObject("emailRouting")?.let { routing ->
            val metadata = VaultMetadata(
                publicEmailDomains = routing.optJSONArray("publicEmailDomainList").toStringList(),
                privateEmailDomains = routing.optJSONArray("privateEmailDomainList").toStringList(),
                hiddenPrivateEmailDomains = routing.optJSONArray("hiddenPrivateEmailDomainList").toStringList(),
                vaultRevisionNumber = if (result.has("pulledRevision")) result.optInt("pulledRevision") else vaultStore.metadata.getVaultRevisionNumber(),
            )
            vaultStore.metadata.storeMetadata(
                JSONObject().apply {
                    put("publicEmailDomains", JSONArray(metadata.publicEmailDomains))
                    put("privateEmailDomains", JSONArray(metadata.privateEmailDomains))
                    put("hiddenPrivateEmailDomains", JSONArray(metadata.hiddenPrivateEmailDomains))
                    put("vaultRevisionNumber", metadata.vaultRevisionNumber)
                }.toString(),
            )
        }
    }

    /**
     * A failed sync return.
     */
    private fun failedSync(error: AppError, wasOffline: Boolean): VaultSyncResult {
        Log.e(TAG, "Sync failed (${error.code}): ${error.message}", error.cause)
        return VaultSyncResult(false, SyncAction.ERROR, vaultStore.metadata.getVaultRevisionNumber(), wasOffline, error.code, error.message)
    }

    /**
     * A failed migration return.
     */
    private fun failedMigration(error: AppError): VaultMigrationResult {
        Log.e(TAG, "Manifest migration failed (${error.code}): ${error.message}", error.cause)
        return VaultMigrationResult(false, false, error.code, error.message)
    }

    /**
     * An error the driver itself threw (a request it could not build, a command it could not decode).
     */
    private fun driverError(e: Exception): AppError = e as? AppError ?: AppError.SyncEngineFailed(e.toString(), e)

    /**
     * The engine's failure as the native error: a forced logout by its reason, else by its error code.
     */
    private fun syncError(result: JSONObject): AppError {
        when (result.optString("errorKey")) {
            "clientVersionNotSupported" -> return AppError.ClientVersionNotSupported()
            "serverVersionNotSupported" -> return AppError.ServerVersionNotSupported()
            "sessionExpired" -> return AppError.SessionExpired()
            "passwordChanged" -> return AppError.PasswordChanged()
            "vaultVersionIncompatible" -> return AppError.VaultVersionIncompatible()
        }
        // The engine's message is diagnostic detail; the code decides what the user sees.
        val message = result.optString("error", "Vault sync failed")
        return when (result.optString("errorCode")) {
            "E-805" -> AppError.VaultSyncTimeout()
            "E-804" -> AppError.VaultTooLarge()
            "E-903" -> AppError.ServerUpdateRequired()
            "E-901" -> AppError.MigrationCheckFailed(message)
            "E-505" -> AppError.ServerUnavailable(0)
            "E-506" -> AppError.ServerError(message)
            "E-507" -> AppError.SyncResponseInvalid(message)
            "E-508" -> AppError.SyncCodecFailed(message)
            "E-509" -> AppError.SyncEngineFailed(message)
            "E-502" -> AppError.SyncVaultFetchFailed(message)
            "E-202" -> AppError.EncryptionKeyNotFound()
            "E-203", "E-503" -> AppError.VaultDecryptFailed()
            "E-601" -> AppError.StorageReadFailed(message)
            "E-602" -> AppError.StorageWriteFailed(message)
            "E-603" -> AppError.DatabaseInitFailed(message)
            "E-702" -> AppError.MaxRetriesReached()
            "E-701" -> AppError.VaultMergeFailed(message)
            "E-801" -> AppError.VaultUploadFailed(message)
            else -> AppError.UnknownError(message)
        }
    }

    private fun JSONArray?.toStringList(): List<String> {
        if (this == null) return emptyList()
        return (0 until length()).map { optString(it) }
    }
}
