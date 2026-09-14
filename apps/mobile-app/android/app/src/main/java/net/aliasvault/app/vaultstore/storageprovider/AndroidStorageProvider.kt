package net.aliasvault.app.vaultstore.storageprovider

import android.content.Context
import androidx.core.content.edit
import java.io.File

/**
 * A file provider that returns the encrypted database file from the Android filesystem.
 */
class AndroidStorageProvider(private val context: Context) : StorageProvider {
    private var defaultAutoLockTimeout = 3600 // 1 hour default

    override fun getEncryptedDatabaseFile(): File {
        return File(context.filesDir, "encrypted_database.db")
    }

    override fun setEncryptedDatabaseFile(encryptedData: String) {
        val file = File(context.filesDir, "encrypted_database.db")
        file.writeText(encryptedData)
    }

    override fun setMetadata(metadata: String) {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            putString("metadata", metadata)
        }
    }

    override fun getMetadata(): String {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        return sharedPreferences.getString("metadata", "") ?: ""
    }

    override fun setKeyDerivationParams(keyDerivationParams: String) {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            putString("key_derivation_params", keyDerivationParams)
        }
    }

    override fun getKeyDerivationParams(): String {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        return sharedPreferences.getString("key_derivation_params", "") ?: ""
    }

    override fun getAccountKeyChain(): String? {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        return sharedPreferences.getString("account_key_chain", null)
    }

    override fun setAccountKeyChain(chainJson: String?) {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            if (chainJson == null) {
                remove("account_key_chain")
            } else {
                putString("account_key_chain", chainJson)
            }
        }
    }

    override fun setAuthMethods(authMethods: String) {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            putString("auth_methods", authMethods)
        }
    }

    override fun getAuthMethods(): String {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        return sharedPreferences.getString("auth_methods", "[]") ?: "[]"
    }

    override fun setAutoLockTimeout(timeout: Int) {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        val editor = sharedPreferences.edit()
        editor.putInt("auto_lock_timeout", timeout)
        editor.apply()
    }

    override fun getAutoLockTimeout(): Int {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        return sharedPreferences.getInt("auto_lock_timeout", defaultAutoLockTimeout)
    }

    override fun clearStorage() {
        // Clear shared preferences, but preserve API URL settings for self-hosted instances
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)

        // Save API URL before clearing
        val apiUrl = sharedPreferences.getString("apiUrl", null)

        // Clear all preferences
        sharedPreferences.edit { clear() }

        // Restore API URL if it was set
        if (apiUrl != null) {
            sharedPreferences.edit {
                putString("apiUrl", apiUrl)
            }
        }

        // Clear encrypted database file
        val encryptedDatabaseFile = File(context.filesDir, "encrypted_database.db")
        if (encryptedDatabaseFile.exists()) {
            encryptedDatabaseFile.delete()
        }
    }

    override fun setUsername(username: String) {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            putString("username", username)
        }
    }

    override fun getUsername(): String? {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        return sharedPreferences.getString("username", null)
    }

    override fun clearUsername() {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            remove("username")
        }
    }

    override fun setOfflineMode(isOffline: Boolean) {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            putBoolean("offline_mode", isOffline)
        }
    }

    override fun getOfflineMode(): Boolean {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        return sharedPreferences.getBoolean("offline_mode", false)
    }

    override fun setServerVersion(version: String) {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            putString("server_version", version)
        }
    }

    override fun getServerVersion(): String? {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        return sharedPreferences.getString("server_version", null)
    }

    override fun clearServerVersion() {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            remove("server_version")
        }
    }

    // region Sync State

    override fun setIsDirty(isDirty: Boolean) {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            putBoolean("is_dirty", isDirty)
        }
    }

    override fun getIsDirty(): Boolean {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        return sharedPreferences.getBoolean("is_dirty", false)
    }

    override fun getMutationSequence(): Int {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        return sharedPreferences.getInt("mutation_sequence", 0)
    }

    override fun setMutationSequence(sequence: Int) {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            putInt("mutation_sequence", sequence)
        }
    }

    override fun setIsSyncing(isSyncing: Boolean) {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            putBoolean("is_syncing", isSyncing)
        }
    }

    override fun getIsSyncing(): Boolean {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        return sharedPreferences.getBoolean("is_syncing", false)
    }

    override fun clearSyncState() {
        val sharedPreferences = context.getSharedPreferences("aliasvault", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            remove("is_dirty")
            remove("mutation_sequence")
            remove("is_syncing")
        }
    }

    // endregion

    // region Sync engine state

    override fun getSyncEngineState(key: String): String? {
        val sharedPreferences = context.getSharedPreferences("aliasvault_sync_state", Context.MODE_PRIVATE)
        return sharedPreferences.getString(key, null)
    }

    override fun setSyncEngineState(key: String, json: String?) {
        val sharedPreferences = context.getSharedPreferences("aliasvault_sync_state", Context.MODE_PRIVATE)
        sharedPreferences.edit {
            if (json == null) remove(key) else putString(key, json)
        }
    }

    override fun clearSyncEngineState() {
        val sharedPreferences = context.getSharedPreferences("aliasvault_sync_state", Context.MODE_PRIVATE)
        sharedPreferences.edit { clear() }
    }

    // endregion

    // region Sync logs

    override fun getSyncLogs(): String? {
        return context.getSharedPreferences("aliasvault_sync_logs", Context.MODE_PRIVATE).getString("logs", null)
    }

    override fun setSyncLogs(json: String) {
        context.getSharedPreferences("aliasvault_sync_logs", Context.MODE_PRIVATE).edit { putString("logs", json) }
    }

    // endregion
}
