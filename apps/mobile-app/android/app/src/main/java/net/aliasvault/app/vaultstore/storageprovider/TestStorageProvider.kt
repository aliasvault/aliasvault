package net.aliasvault.app.vaultstore.storageprovider

import java.io.File

/**
 * A fake file provider that mocks the storage of the encrypted database file and metadata.
 */
class TestStorageProvider : StorageProvider {
    private var defaultAutoLockTimeout = 3600 // 1 hour default

    private val tempFile = File.createTempFile("encrypted_database", ".db")
    private var tempMetadata = String()
    private var tempKeyDerivationParams = String()
    private var tempAuthMethods = "[]"
    private var tempAutoLockTimeout = defaultAutoLockTimeout
    private var username: String? = null
    private var offlineMode: Boolean = false

    override fun getEncryptedDatabaseFile(): File = tempFile

    override fun setEncryptedDatabaseFile(encryptedData: String) {
        tempFile.writeText(encryptedData)
    }

    override fun getRandomTempFilePath(): String {
        val tempFile = File.createTempFile("temp_db", ".sqlite")
        tempFile.deleteOnExit()
        return tempFile.absolutePath
    }

    override fun setMetadata(metadata: String) {
        tempMetadata = metadata
    }

    override fun getMetadata(): String {
        return tempMetadata
    }

    override fun setKeyDerivationParams(keyDerivationParams: String) {
        tempKeyDerivationParams = keyDerivationParams
    }

    override fun getKeyDerivationParams(): String {
        return tempKeyDerivationParams
    }

    override fun setAuthMethods(authMethods: String) {
        tempAuthMethods = authMethods
    }

    override fun getAuthMethods(): String {
        return tempAuthMethods
    }

    override fun setAutoLockTimeout(timeout: Int) {
        defaultAutoLockTimeout = timeout
    }

    override fun getAutoLockTimeout(): Int {
        return defaultAutoLockTimeout
    }

    override fun clearStorage() {
        tempFile.delete()
        tempMetadata = ""
        tempKeyDerivationParams = ""
        tempAuthMethods = "[]"
        tempAutoLockTimeout = defaultAutoLockTimeout
    }

    override fun setUsername(username: String) {
        this.username = username
    }

    override fun getUsername(): String? {
        return username
    }

    override fun clearUsername() {
        username = null
    }

    override fun setOfflineMode(isOffline: Boolean) {
        offlineMode = isOffline
    }

    override fun getOfflineMode(): Boolean {
        return offlineMode
    }
}
