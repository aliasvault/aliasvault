package net.aliasvault.app.vaultstore.storageprovider

import android.content.Context
import java.io.File

/**
 * A fake file provider that mocks the storage of the encrypted database file and metadata.
 */
class TestStorageProvider : StorageProvider {
    private var defaultAutoLockTimeout = 3600 // 1 hour default

    private val tempFile = File.createTempFile("encrypted_database", ".db")
    private var tempMetadata = String()
    private var tempKeyDerivationParams = String()
    private var tempAccountKeyChain: String? = null
    private var tempAuthMethods = "[]"
    private var tempAutoLockTimeout = defaultAutoLockTimeout
    private var username: String? = null
    private var offlineMode: Boolean = false
    private var serverVersion: String? = null
    private var capabilities: String? = null
    private var isDirty: Boolean = false
    private var dirtyScopes: List<String> = emptyList()
    private var mutationSequence: Int = 0
    private var isSyncing: Boolean = false

    override fun getAppContext(): Context? = null

    override fun getEncryptedDatabaseFile(): File = tempFile

    override fun setEncryptedDatabaseFile(encryptedData: String) {
        tempFile.writeText(encryptedData)
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

    override fun getAccountKeyChain(): String? {
        return tempAccountKeyChain
    }

    override fun setAccountKeyChain(chainJson: String?) {
        tempAccountKeyChain = chainJson
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
        tempAccountKeyChain = null
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

    override fun setServerVersion(version: String) {
        serverVersion = version
    }

    override fun getServerVersion(): String? {
        return serverVersion
    }

    override fun clearServerVersion() {
        serverVersion = null
    }

    override fun setCapabilities(json: String) {
        capabilities = json
    }

    override fun getCapabilities(): String? {
        return capabilities
    }

    // region Sync State

    override fun setIsDirty(isDirty: Boolean) {
        this.isDirty = isDirty
    }

    override fun getIsDirty(): Boolean {
        return isDirty
    }

    override fun getDirtyScopes(): List<String> {
        return dirtyScopes
    }

    override fun setDirtyScopes(scopes: List<String>) {
        dirtyScopes = scopes
    }

    override fun getMutationSequence(): Int {
        return mutationSequence
    }

    override fun setMutationSequence(sequence: Int) {
        mutationSequence = sequence
    }

    override fun setIsSyncing(isSyncing: Boolean) {
        this.isSyncing = isSyncing
    }

    override fun getIsSyncing(): Boolean {
        return isSyncing
    }

    override fun clearSyncState() {
        isDirty = false
        dirtyScopes = emptyList()
        mutationSequence = 0
        isSyncing = false
    }

    // endregion

    // region Sync engine state

    private val syncEngineState = mutableMapOf<String, String>()

    override fun getSyncEngineState(key: String): String? {
        return syncEngineState[key]
    }

    override fun setSyncEngineState(key: String, json: String?) {
        if (json == null) syncEngineState.remove(key) else syncEngineState[key] = json
    }

    override fun clearSyncEngineState() {
        syncEngineState.clear()
    }

    // endregion

    // region Sync logs

    private var syncLogs: String? = null

    override fun getSyncLogs(): String? = syncLogs

    override fun setSyncLogs(json: String) {
        syncLogs = json
    }

    // endregion
}
