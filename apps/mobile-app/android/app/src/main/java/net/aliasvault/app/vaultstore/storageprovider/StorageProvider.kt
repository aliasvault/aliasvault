package net.aliasvault.app.vaultstore.storageprovider

import android.content.Context
import java.io.File

/**
 * Interface for storage providers that can store and retrieve data.
 * This allows for different implementations for real devices and testing.
 */
interface StorageProvider {
    /**
     * The application context, for the string resources the native layer renders. Null outside an Android app
     * (unit tests), where callers fall back to their untranslated default.
     * @return The application context, or null when there is none
     */
    fun getAppContext(): Context?

    /**
     * Get the encrypted database file.
     * @return The encrypted database file
     */
    fun getEncryptedDatabaseFile(): File

    /**
     * Set the encrypted database file.
     * @param encryptedData The encrypted database data as a base64 encoded string
     */
    fun setEncryptedDatabaseFile(encryptedData: String)

    /**
     * Get the key derivation parameters.
     * @return The key derivation parameters as a string
     */
    fun getKeyDerivationParams(): String

    /**
     * Set the key derivation parameters.
     * @param keyDerivationParams The key derivation parameters as a string
     */
    fun setKeyDerivationParams(keyDerivationParams: String)

    /**
     * Get the account-key chain JSON, or null for a legacy account.
     * @return The account-key chain JSON or null
     */
    fun getAccountKeyChain(): String?

    /**
     * Set the account-key chain JSON. Null clears it.
     * @param chainJson The account-key chain JSON or null
     */
    fun setAccountKeyChain(chainJson: String?)

    /**
     * Get the metadata.
     * @return The metadata as a string
     */
    fun getMetadata(): String

    /**
     * Set the metadata.
     * @param metadata The metadata as a string
     */
    fun setMetadata(metadata: String)

    /**
     * Get the auto-lock timeout.
     * @return The auto-lock timeout in seconds
     */
    fun getAutoLockTimeout(): Int

    /**
     * Set the auto-lock timeout.
     * @param timeout The auto-lock timeout in seconds
     */
    fun setAutoLockTimeout(timeout: Int)

    /**
     * Get the authentication methods.
     * @return The authentication methods as a string
     */
    fun getAuthMethods(): String

    /**
     * Set the authentication methods.
     * @param authMethods The authentication methods as a string
     */
    fun setAuthMethods(authMethods: String)

    /**
     * Clear all data from the storage provider.
     */
    fun clearStorage()

    /**
     * Set the username.
     * @param username The username to store
     */
    fun setUsername(username: String)

    /**
     * Get the username.
     * @return The username or null if not set
     */
    fun getUsername(): String?

    /**
     * Clear the username.
     */
    fun clearUsername()

    /**
     * Set offline mode flag.
     * @param isOffline Whether the app is in offline mode
     */
    fun setOfflineMode(isOffline: Boolean)

    /**
     * Get offline mode flag.
     * @return True if app is in offline mode, false otherwise
     */
    fun getOfflineMode(): Boolean

    /**
     * Set the server API version.
     * @param version The server version to store
     */
    fun setServerVersion(version: String)

    /**
     * Get the server API version.
     * @return The server version or null if not set
     */
    fun getServerVersion(): String?

    /**
     * Clear the server version.
     */
    fun clearServerVersion()

    /**
     * Set the capabilities the server resolved for this account.
     * @param json The capabilities as a JSON object, keyed by capability key
     */
    fun setCapabilities(json: String)

    /**
     * Get the capabilities the server resolved for this account.
     * @return The capabilities as a JSON object, or null if none were stored yet
     */
    fun getCapabilities(): String?

    // region Sync State

    /**
     * Set the dirty flag indicating local changes need to be synced.
     * @param isDirty Whether the vault has unsynced changes
     */
    fun setIsDirty(isDirty: Boolean)

    /**
     * Get the dirty flag.
     * @return True if vault has unsynced changes
     */
    fun getIsDirty(): Boolean

    /**
     * Get the mutation scopes that have pending changes.
     * @return The recorded scopes, empty when nothing is pending
     */
    fun getDirtyScopes(): List<String>

    /**
     * Set the mutation scopes that have pending changes.
     * @param scopes The scopes to record; an empty list forgets them
     */
    fun setDirtyScopes(scopes: List<String>)

    /**
     * Get the mutation sequence number.
     * @return The current mutation sequence
     */
    fun getMutationSequence(): Int

    /**
     * Set the mutation sequence number.
     * @param sequence The new mutation sequence value
     */
    fun setMutationSequence(sequence: Int)

    /**
     * Set the syncing flag.
     * @param isSyncing Whether a sync operation is in progress
     */
    fun setIsSyncing(isSyncing: Boolean)

    /**
     * Get the syncing flag.
     * @return True if a sync operation is in progress
     */
    fun getIsSyncing(): Boolean

    /**
     * Clear all sync state (isDirty, mutationSequence, isSyncing).
     */
    fun clearSyncState()

    // endregion

    // region Sync engine state

    /**
     * Read one persisted value of the Rust sync engine (revisions, fingerprints, key blobs), as JSON text.
     * @param key The engine's storage key
     * @return The JSON text, or null when absent
     */
    fun getSyncEngineState(key: String): String?

    /**
     * Write (or with null, delete) one persisted value of the Rust sync engine.
     * @param key The engine's storage key
     * @param json The JSON text, or null to delete
     */
    fun setSyncEngineState(key: String, json: String?)

    /**
     * Forget every persisted value of the Rust sync engine (revisions, fingerprints, blob cache, key chain).
     */
    fun clearSyncEngineState()

    // endregion

    // region Sync logs

    /**
     * Get the persisted logs of the recent sync engine runs.
     * @return The JSON array text, newest first, or null when none were recorded
     */
    fun getSyncLogs(): String?

    /**
     * Set the persisted logs of the recent sync engine runs.
     * @param json The JSON array text, newest first
     */
    fun setSyncLogs(json: String)

    // endregion
}
