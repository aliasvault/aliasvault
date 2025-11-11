package net.aliasvault.app.vaultstore

import android.os.Handler
import android.os.Looper
import io.requery.android.database.sqlite.SQLiteDatabase
import net.aliasvault.app.vaultstore.interfaces.CredentialOperationCallback
import net.aliasvault.app.vaultstore.interfaces.CryptoOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreProvider
import net.aliasvault.app.vaultstore.models.Credential
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider

/**
 * The vault store that manages the encrypted vault and all input/output operations on it.
 * This class is used both by React Native and by the native Android autofill service.
 *
 * This class uses composition to organize functionality into specialized components:
 * - VaultCrypto: Handles encryption, decryption, and key management
 * - VaultDatabase: Handles database storage and operations
 * - VaultQuery: Handles SQL query execution and credential retrieval
 * - VaultMetadataManager: Handles metadata and settings storage
 * - VaultAuth: Handles authentication methods and auto-lock
 * - VaultSync: Handles vault synchronization with server
 * - VaultMutate: Handles vault mutation (uploading changes)
 * - VaultCache: Handles cache and storage clearing
 *
 * @param storageProvider The storage provider
 * @param keystoreProvider The keystore provider
 */
class VaultStore(
    private val storageProvider: StorageProvider,
    private val keystoreProvider: KeystoreProvider,
) {
    companion object {
        @Volatile
        private var instance: VaultStore? = null

        /**
         * Get the instance of the vault store.
         * @param keystoreProvider The keystore provider
         * @param storageProvider The storage provider
         * @return The instance of the vault store
         */
        @JvmStatic
        fun getInstance(
            keystoreProvider: KeystoreProvider,
            storageProvider: StorageProvider,
        ): VaultStore {
            return instance ?: synchronized(this) {
                instance ?: VaultStore(storageProvider, keystoreProvider).also { instance = it }
            }
        }

        /**
         * Get the existing instance of the vault store.
         * @return The existing instance of the vault store
         */
        @JvmStatic
        fun getExistingInstance(): VaultStore? {
            return instance
        }
    }

    // region Composed Components

    private val crypto = VaultCrypto(keystoreProvider, storageProvider)
    private val databaseComponent = VaultDatabase(storageProvider, crypto)
    private val query = VaultQuery(databaseComponent)
    private val metadata = VaultMetadataManager(storageProvider)
    private val auth = VaultAuth(storageProvider) { cache.clearCache() }
    private val sync = VaultSync(databaseComponent, metadata, crypto)
    private val mutate = VaultMutate(databaseComponent, query, metadata)
    private val cache = VaultCache(crypto, databaseComponent, keystoreProvider, storageProvider)
    private val passkey = VaultPasskey(databaseComponent)
    private val pin = VaultPin(storageProvider)

    // endregion

    // region Internal Accessors for Backwards Compatibility

    /**
     * Internal accessor for encryption key.
     */
    internal var encryptionKey: ByteArray?
        get() = crypto.encryptionKey
        set(value) {
            crypto.encryptionKey = value
        }

    /**
     * Internal accessor for database connection.
     */
    internal val database: SQLiteDatabase?
        get() = databaseComponent.dbConnection

    /**
     * Internal accessor for database connection (legacy name).
     */
    internal val dbConnection: SQLiteDatabase?
        get() = databaseComponent.dbConnection

    /**
     * Internal accessor for auto-lock handler.
     */
    internal var autoLockHandler: Handler? = null

    /**
     * Internal accessor for auto-lock runnable.
     */
    internal var autoLockRunnable: Runnable? = null

    // endregion

    init {
        autoLockHandler = Handler(Looper.getMainLooper())
        auth.setAutoLockHandler(autoLockHandler!!)
    }

    // region Lifecycle Methods

    /**
     * Called when the app enters the background.
     */
    fun onAppBackgrounded() {
        auth.onAppBackgrounded()
    }

    /**
     * Called when the app enters the foreground.
     */
    fun onAppForegrounded() {
        auth.onAppForegrounded()
    }

    // endregion

    // region Crypto Methods

    /**
     * Store the encryption key.
     */
    fun storeEncryptionKey(base64EncryptionKey: String) {
        crypto.storeEncryptionKey(base64EncryptionKey, auth.getAuthMethods())
    }

    /**
     * Initialize the encryption key.
     */
    fun initEncryptionKey(base64EncryptionKey: String) {
        crypto.initEncryptionKey(base64EncryptionKey)
    }

    /**
     * Get the encryption key.
     */
    fun getEncryptionKey(callback: CryptoOperationCallback) {
        crypto.getEncryptionKey(callback, auth.getAuthMethods())
    }

    /**
     * Check if biometric authentication is enabled and available.
     */
    fun isBiometricAuthEnabled(): Boolean {
        return crypto.isBiometricAuthEnabled(auth.getAuthMethods())
    }

    /**
     * Store the encryption key derivation parameters.
     */
    fun storeEncryptionKeyDerivationParams(keyDerivationParams: String) {
        crypto.storeEncryptionKeyDerivationParams(keyDerivationParams)
    }

    /**
     * Get the encryption key derivation parameters.
     */
    fun getEncryptionKeyDerivationParams(): String {
        return crypto.getEncryptionKeyDerivationParams()
    }

    /**
     * Derive a key from a password using Argon2Id.
     */
    fun deriveKeyFromPassword(
        password: String,
        salt: String,
        encryptionType: String,
        encryptionSettings: String,
    ): ByteArray {
        return crypto.deriveKeyFromPassword(password, salt, encryptionType, encryptionSettings)
    }

    // endregion

    // region Database Methods

    /**
     * Store the encrypted database.
     */
    fun storeEncryptedDatabase(encryptedData: String) {
        databaseComponent.storeEncryptedDatabase(encryptedData)
    }

    /**
     * Get the encrypted database.
     */
    fun getEncryptedDatabase(): String {
        return databaseComponent.getEncryptedDatabase()
    }

    /**
     * Check if the encrypted database exists.
     */
    fun hasEncryptedDatabase(): Boolean {
        return databaseComponent.hasEncryptedDatabase()
    }

    /**
     * Unlock the vault.
     */
    fun unlockVault() {
        databaseComponent.unlockVault(auth.getAuthMethods())
    }

    /**
     * Check if the vault is unlocked.
     */
    fun isVaultUnlocked(): Boolean {
        return databaseComponent.isVaultUnlocked()
    }

    // endregion

    // region Query Methods

    /**
     * Execute a read-only SQL query (SELECT) on the vault.
     */
    fun executeQuery(queryString: String, params: Array<Any?>): List<Map<String, Any?>> {
        return query.executeQuery(queryString, params)
    }

    /**
     * Execute an SQL update on the vault that mutates it.
     */
    fun executeUpdate(queryString: String, params: Array<Any?>): Int {
        return query.executeUpdate(queryString, params)
    }

    /**
     * Execute a raw SQL command on the vault without parameters.
     */
    fun executeRaw(queryString: String) {
        query.executeRaw(queryString)
    }

    /**
     * Begin a SQL transaction on the vault.
     */
    fun beginTransaction() {
        databaseComponent.beginTransaction()
    }

    /**
     * Commit a SQL transaction on the vault.
     */
    fun commitTransaction() {
        databaseComponent.commitTransaction()
    }

    /**
     * Rollback a SQL transaction on the vault.
     */
    fun rollbackTransaction() {
        databaseComponent.rollbackTransaction()
    }

    /**
     * Get all credentials from the vault.
     */
    fun getAllCredentials(): List<Credential> {
        return query.getAllCredentials()
    }

    /**
     * Attempts to get all credentials using only the cached encryption key.
     */
    fun tryGetAllCredentials(callback: CredentialOperationCallback): Boolean {
        return query.tryGetAllCredentials(callback, crypto) { unlockVault() }
    }

    // endregion

    // region Authentication Methods

    /**
     * Set the auth methods.
     */
    fun setAuthMethods(authMethods: String) {
        val previousAuthMethods = auth.getAuthMethods()
        val wasBiometricEnabled = previousAuthMethods.contains("faceid")
        val isBiometricEnabled = authMethods.contains("faceid")

        auth.setAuthMethods(authMethods)

        // If biometrics were just enabled and we have an encryption key in memory, persist it
        if (!wasBiometricEnabled && isBiometricEnabled && crypto.encryptionKey != null && keystoreProvider.isBiometricAvailable()) {
            crypto.storeEncryptionKey(
                android.util.Base64.encodeToString(crypto.encryptionKey, android.util.Base64.NO_WRAP),
                authMethods,
            )
        }

        // If biometrics were disabled, clear the biometric key
        if (wasBiometricEnabled && !isBiometricEnabled) {
            keystoreProvider.clearKeys()
        }
    }

    /**
     * Get the auth methods.
     */
    fun getAuthMethods(): String {
        return auth.getAuthMethods()
    }

    /**
     * Set the auto-lock timeout.
     */
    fun setAutoLockTimeout(timeout: Int) {
        auth.setAutoLockTimeout(timeout)
    }

    /**
     * Get the auto-lock timeout.
     */
    fun getAutoLockTimeout(): Int {
        return auth.getAutoLockTimeout()
    }

    // endregion

    // region Metadata Methods

    /**
     * Store the metadata.
     */
    fun storeMetadata(metadataString: String) {
        metadata.storeMetadata(metadataString)
    }

    /**
     * Get the metadata.
     */
    fun getMetadata(): String {
        return metadata.getMetadata()
    }

    /**
     * Set the vault revision number.
     */
    fun setVaultRevisionNumber(revisionNumber: Int) {
        metadata.setVaultRevisionNumber(revisionNumber)
    }

    /**
     * Get the vault revision number.
     */
    fun getVaultRevisionNumber(): Int {
        return metadata.getVaultRevisionNumber()
    }

    /**
     * Set the username.
     */
    fun setUsername(username: String) {
        metadata.setUsername(username)
    }

    /**
     * Get the username.
     */
    fun getUsername(): String? {
        return metadata.getUsername()
    }

    /**
     * Clear the username.
     */
    fun clearUsername() {
        metadata.clearUsername()
    }

    /**
     * Set offline mode flag.
     */
    fun setOfflineMode(isOffline: Boolean) {
        metadata.setOfflineMode(isOffline)
    }

    /**
     * Get offline mode flag.
     */
    fun getOfflineMode(): Boolean {
        return metadata.getOfflineMode()
    }

    // endregion

    // region Sync Methods

    /**
     * Check if a new vault version is available on the server.
     */
    suspend fun isNewVaultVersionAvailable(webApiService: net.aliasvault.app.webapi.WebApiService): Map<String, Any?> {
        return sync.isNewVaultVersionAvailable(webApiService)
    }

    /**
     * Download and store the vault from the server.
     */
    suspend fun downloadVault(webApiService: net.aliasvault.app.webapi.WebApiService, newRevision: Int): Boolean {
        val result = sync.downloadVault(webApiService, newRevision)
        // Re-unlock vault if it was unlocked before download
        if (result && isVaultUnlocked()) {
            unlockVault()
        }
        return result
    }

    /**
     * Sync the vault with the server.
     */
    suspend fun syncVault(webApiService: net.aliasvault.app.webapi.WebApiService): Boolean {
        return sync.syncVault(webApiService)
    }

    // endregion

    // region Mutate Methods

    /**
     * Execute a vault mutation operation.
     */
    suspend fun mutateVault(webApiService: net.aliasvault.app.webapi.WebApiService): Boolean {
        return mutate.mutateVault(webApiService)
    }

    // endregion

    // region Passkey Methods

    /**
     * Get a passkey by its credential ID (the WebAuthn credential ID).
     */
    fun getPasskeyByCredentialId(credentialId: ByteArray): net.aliasvault.app.vaultstore.models.Passkey? {
        return passkey.getPasskeyByCredentialId(credentialId)
    }

    /**
     * Get all passkeys for a credential.
     */
    @Suppress("UnusedParameter")
    fun getPasskeysForCredential(
        credentialId: java.util.UUID,
        db: io.requery.android.database.sqlite.SQLiteDatabase,
    ): List<net.aliasvault.app.vaultstore.models.Passkey> {
        return passkey.getPasskeysForCredential(credentialId)
    }

    /**
     * Get all passkeys for a specific relying party identifier (RP ID).
     */
    fun getPasskeysForRpId(
        rpId: String,
    ): List<net.aliasvault.app.vaultstore.models.Passkey> {
        return passkey.getPasskeysForRpId(rpId)
    }

    /**
     * Get passkeys with credential info for a specific rpId.
     */
    fun getPasskeysWithCredentialInfo(
        rpId: String,
        userName: String? = null,
        userId: ByteArray? = null,
    ): List<PasskeyWithCredentialInfo> {
        return passkey.getPasskeysWithCredentialInfo(rpId, userName, userId)
    }

    /**
     * Get all passkeys with their associated credentials in a single query.
     */
    fun getAllPasskeysWithCredentials(): List<PasskeyWithCredential> {
        return passkey.getAllPasskeysWithCredentials()
    }

    /**
     * Get a passkey by its ID.
     */
    @Suppress("UnusedParameter")
    fun getPasskeyById(
        passkeyId: java.util.UUID,
        db: io.requery.android.database.sqlite.SQLiteDatabase,
    ): net.aliasvault.app.vaultstore.models.Passkey? {
        return passkey.getPasskeyById(passkeyId)
    }

    /**
     * Insert a new passkey into the database.
     */
    @Suppress("UnusedParameter")
    fun insertPasskey(passkeyObj: net.aliasvault.app.vaultstore.models.Passkey, db: io.requery.android.database.sqlite.SQLiteDatabase) {
        passkey.insertPasskey(passkeyObj)
    }

    /**
     * Create a credential with a passkey.
     */
    fun createCredentialWithPasskey(
        rpId: String,
        userName: String?,
        displayName: String,
        passkeyObj: net.aliasvault.app.vaultstore.models.Passkey,
        logo: ByteArray? = null,
    ): net.aliasvault.app.vaultstore.models.Credential {
        return passkey.createCredentialWithPasskey(rpId, userName, displayName, passkeyObj, logo)
    }

    /**
     * Replace an existing passkey with a new one.
     */
    fun replacePasskey(
        oldPasskeyId: java.util.UUID,
        newPasskey: net.aliasvault.app.vaultstore.models.Passkey,
        displayName: String,
        logo: ByteArray? = null,
    ) {
        passkey.replacePasskey(oldPasskeyId, newPasskey, displayName, logo)
    }

    // endregion

    // region Cache Methods

    /**
     * Clear the memory, removing the encryption key and decrypted database from memory.
     */
    fun clearCache() {
        cache.clearCache()
    }

    /**
     * Clear all vault data including from persisted storage.
     */
    fun clearVault() {
        cache.clearVault()
    }

    // endregion

    // region PIN Methods

    /**
     * Check if PIN unlock is enabled.
     */
    fun isPinEnabled(): Boolean {
        return pin.isPinEnabled()
    }

    /**
     * Get the configured PIN length.
     */
    fun getPinLength(): Int? {
        return pin.getPinLength()
    }

    /**
     * Get failed PIN attempts count.
     */
    fun getPinFailedAttempts(): Int {
        return pin.getPinFailedAttempts()
    }

    /**
     * Setup PIN unlock.
     */
    @Throws(Exception::class)
    fun setupPin(pinValue: String, vaultEncryptionKeyBase64: String) {
        pin.setupPin(pinValue, vaultEncryptionKeyBase64)
    }

    /**
     * Unlock with PIN.
     */
    @Throws(Exception::class)
    fun unlockWithPin(pinValue: String): String {
        return pin.unlockWithPin(pinValue)
    }

    /**
     * Reset failed PIN attempts counter.
     */
    fun resetPinFailedAttempts() {
        pin.resetPinFailedAttempts()
    }

    /**
     * Disable PIN unlock and remove all stored data.
     */
    fun removeAndDisablePin() {
        pin.removeAndDisablePin()
    }

    // endregion
}
