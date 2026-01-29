package net.aliasvault.app.vaultstore.storageprovider

import java.io.File

/**
 * Interface for storage providers that can store and retrieve data.
 * This allows for different implementations for real devices and testing.
 */
interface StorageProvider {
    /**
     * Get the encrypted database file.
     * @return The encrypted database file
     */
    fun getEncryptedDatabaseFile(): File

    /**
     * Get a random temporary file path.
     * @return The random temporary file path as a string
     */
    fun getRandomTempFilePath(): String

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

    /**
     * Get the cache directory for temporary files.
     * @return The cache directory
     */
    fun getCacheDir(): File
}
