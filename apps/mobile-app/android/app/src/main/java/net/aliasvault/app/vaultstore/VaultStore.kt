package net.aliasvault.app.vaultstore

import android.util.Log
import io.requery.android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.suspendCancellableCoroutine
import net.aliasvault.app.vaultstore.interfaces.CryptoOperationCallback
import net.aliasvault.app.vaultstore.interfaces.ItemOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.BiometricAuthCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreProvider
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.StoreVaultResult
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import kotlin.coroutines.resume

/**
 * The vault store that manages the encrypted vault and all input/output operations on it.
 * This class is used both by React Native and by the native Android autofill service.
 *
 * This class uses composition to organize functionality into specialized components:
 * - VaultCrypto: Handles encryption, decryption, and key management
 * - VaultDatabase: Handles database storage and operations
 * - ItemRepository: Handles item queries through the repository pattern
 * - VaultMetadataManager: Handles metadata and settings storage
 * - VaultAuth: Handles authentication methods and auto-lock
 * - VaultSync: Handles vault synchronization with server
 * - VaultMutate: Handles vault mutation (uploading changes)
 * - VaultCache: Handles cache and storage clearing
 *
 * @param storageProvider The storage provider.
 * @param keystoreProvider The keystore provider.
 */
@Suppress("TooManyFunctions") // This is a facade class that delegates to specialized components
class VaultStore(
    private val storageProvider: StorageProvider,
    private val keystoreProvider: KeystoreProvider,
) {
    companion object {
        private const val TAG = "VaultStore"

        @Volatile
        private var instance: VaultStore? = null

        /**
         * Prefix used to identify base64-encoded blob data from React Native.
         * The React Native side prefixes base64 strings with this to indicate
         * they should be converted to ByteArray for SQLite BLOB storage.
         */
        private const val BASE64_BLOB_PREFIX = "av-base64-to-blob:"

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
    internal val database = VaultDatabase(storageProvider, crypto)
    private val itemRepository = net.aliasvault.app.vaultstore.repositories.ItemRepository(database)
    internal val metadata = VaultMetadataManager(storageProvider)
    private val auth = VaultAuth(storageProvider) { cache.clearCache() }
    private val sync = VaultSync(database, metadata, crypto, storageProvider, itemRepository)
    private val mutate = VaultMutate(database, itemRepository, metadata)
    private val cache = VaultCache(crypto, database, keystoreProvider, storageProvider)
    private val passkey = VaultPasskey(database)
    private val pin by lazy {
        val androidProvider = storageProvider as net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider
        // Use reflection to access private context field
        val contextField = androidProvider.javaClass.getDeclaredField("context")
        contextField.isAccessible = true
        val context = contextField.get(androidProvider) as android.content.Context
        VaultPin(context)
    }

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
     * Internal accessor for VaultAuth.
     */
    internal val vaultAuth: VaultAuth
        get() = auth

    // endregion

    // region Crypto Methods

    /**
     * Store the encryption key.
     */
    fun storeEncryptionKey(base64EncryptionKey: String) {
        crypto.storeEncryptionKey(base64EncryptionKey, auth.getAuthMethods())
    }

    /**
     * Store the encryption key in memory only.
     */
    fun storeEncryptionKeyInMemory(base64EncryptionKey: String) {
        crypto.storeEncryptionKeyInMemory(base64EncryptionKey)
    }

    /**
     * Clear the encryption key from memory.
     * This forces getEncryptionKey() to fetch from keystore on next biometric access.
     */
    fun clearEncryptionKeyFromMemory() {
        crypto.clearEncryptionKeyFromMemory()
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

    /**
     * Encrypts the vault's encryption key using an RSA public key for mobile login.
     */
    fun encryptDecryptionKeyForMobileLogin(publicKeyJWK: String): String {
        return crypto.encryptDecryptionKeyForMobileLogin(publicKeyJWK, auth.getAuthMethods())
    }

    /**
     * Verify password and return encryption key if correct.
     * Returns null if password is incorrect.
     *
     * @param password The password to verify
     * @return The base64-encoded encryption key if password is correct, null otherwise
     */
    @Suppress("SwallowedException")
    fun verifyPassword(password: String): String? {
        return try {
            // Get encryption key derivation parameters
            val params = crypto.getEncryptionKeyDerivationParams()
            val paramsJson = org.json.JSONObject(params)
            val salt = paramsJson.getString("salt")
            val encryptionType = paramsJson.getString("encryptionType")
            val encryptionSettings = paramsJson.getString("encryptionSettings")

            // Derive key from password
            val derivedKey = crypto.deriveKeyFromPassword(password, salt, encryptionType, encryptionSettings)

            // Try to decrypt the vault to verify the password is correct
            val encryptedDb = database.getEncryptedDatabase()
            val encryptedDbBytes = android.util.Base64.decode(encryptedDb, android.util.Base64.NO_WRAP)

            // Attempt decryption to verify password is correct
            VaultCrypto.decrypt(encryptedDbBytes, derivedKey)

            // If decryption succeeded, return the key as base64
            android.util.Base64.encodeToString(derivedKey, android.util.Base64.NO_WRAP)
        } catch (e: Exception) {
            // Password incorrect or decryption failed - intentionally return null
            // We don't log the error as this is expected when password is incorrect
            null
        }
    }

    // endregion

    // region Database Methods

    /**
     * Store the encrypted database.
     */
    fun storeEncryptedDatabase(encryptedData: String) {
        database.storeEncryptedDatabase(encryptedData)
    }

    /**
     * Get the encrypted database.
     */
    fun getEncryptedDatabase(): String {
        return database.getEncryptedDatabase()
    }

    /**
     * Check if the encrypted database exists.
     */
    fun hasEncryptedDatabase(): Boolean {
        return database.hasEncryptedDatabase()
    }

    /**
     * Unlock the vault.
     */
    fun unlockVault() {
        database.unlockVault(auth.getAuthMethods())
    }

    /**
     * Check if the vault is unlocked.
     */
    fun isVaultUnlocked(): Boolean {
        return database.isVaultUnlocked()
    }

    // endregion

    // region Query Methods

    /**
     * Execute a read-only SQL query (SELECT) on the vault.
     */
    fun executeQuery(queryString: String, params: Array<Any?>): List<Map<String, Any?>> {
        val db = database.dbConnection ?: error("Database not initialized")

        // Process params - convert base64-prefixed strings to ByteArray for blob binding
        val convertedParams = params.map { param ->
            when {
                param == null -> null
                param is String && param.startsWith(BASE64_BLOB_PREFIX) -> {
                    val base64 = param.removePrefix(BASE64_BLOB_PREFIX)
                    android.util.Base64.decode(base64, android.util.Base64.NO_WRAP)
                }
                param is ByteArray -> param
                else -> param.toString()
            }
        }.toTypedArray()

        val cursor = db.query(queryString, convertedParams)
        val results = mutableListOf<Map<String, Any?>>()

        cursor.use {
            val columnNames = it.columnNames
            while (it.moveToNext()) {
                val row = mutableMapOf<String, Any?>()
                for (columnName in columnNames) {
                    val colIndex = it.getColumnIndexOrThrow(columnName)
                    val colType = it.getType(colIndex)
                    when (colType) {
                        android.database.Cursor.FIELD_TYPE_NULL -> row[columnName] = null
                        android.database.Cursor.FIELD_TYPE_INTEGER -> row[columnName] = it.getLong(colIndex)
                        android.database.Cursor.FIELD_TYPE_FLOAT -> row[columnName] = it.getDouble(colIndex)
                        android.database.Cursor.FIELD_TYPE_STRING -> row[columnName] = it.getString(colIndex)
                        android.database.Cursor.FIELD_TYPE_BLOB -> row[columnName] = it.getBlob(colIndex)
                    }
                }
                results.add(row)
            }
        }

        return results
    }

    /**
     * Execute an SQL update on the vault that mutates it.
     */
    fun executeUpdate(queryString: String, params: Array<Any?>): Int {
        val db = database.dbConnection ?: error("Database not initialized")

        // Process params - convert base64-prefixed strings to ByteArray for blob binding
        val processedParams = params.map { param ->
            when {
                param == null -> null
                param is String && param.startsWith(BASE64_BLOB_PREFIX) -> {
                    val base64 = param.removePrefix(BASE64_BLOB_PREFIX)
                    android.util.Base64.decode(base64, android.util.Base64.NO_WRAP)
                }
                param is ByteArray -> param
                else -> param.toString()
            }
        }

        val stmt = db.compileStatement(queryString)
        try {
            processedParams.forEachIndexed { index, value ->
                when (value) {
                    null -> stmt.bindNull(index + 1)
                    is ByteArray -> stmt.bindBlob(index + 1, value)
                    else -> stmt.bindString(index + 1, value.toString())
                }
            }
            stmt.execute()
        } finally {
            stmt.close()
        }

        // Get the number of affected rows
        val affectedCursor = db.rawQuery("SELECT changes()", null)
        affectedCursor.use {
            if (it.moveToFirst()) {
                return it.getInt(0)
            }
        }
        return 0
    }

    /**
     * Execute a raw SQL command on the vault without parameters.
     * Splits the query by semicolons to handle multiple statements.
     *
     * Note: Migration SQL scripts handle their own transactions and PRAGMA statements.
     * PRAGMA foreign_keys statements MUST be executed outside of transactions to take effect,
     * which is why we execute them using rawQuery instead of compileStatement.
     */
    fun executeRaw(queryString: String) {
        val db = database.dbConnection ?: error("Database not initialized")

        // Strip BOM (U+FEFF) that may be present at the start of SQL strings.
        val cleanedQuery = queryString.trimStart('\uFEFF')

        // Split by semicolons to handle multiple statements and filter out empty ones
        cleanedQuery.split(";")
            .map { it.trim().trimStart('\uFEFF') }
            .filter { it.isNotEmpty() && !it.startsWith("--") }
            .forEach { trimmed ->
                val upperTrimmed = trimmed.uppercase()
                when {
                    // Handle PRAGMA statements using rawQuery (required for PRAGMA to work properly)
                    upperTrimmed.startsWith("PRAGMA") -> db.rawQuery(trimmed, null)?.close()
                    // Handle transaction control statements using execSQL
                    isTransactionControlStatement(upperTrimmed) -> db.execSQL(trimmed)
                    // Use compileStatement for all other SQL (DDL and DML)
                    else -> db.compileStatement(trimmed).execute()
                }
            }
    }

    /**
     * Check if a SQL statement is a transaction control statement.
     */
    private fun isTransactionControlStatement(upperStatement: String): Boolean {
        return upperStatement.startsWith("BEGIN TRANSACTION") ||
            upperStatement.startsWith("BEGIN") ||
            upperStatement.startsWith("COMMIT") ||
            upperStatement.startsWith("ROLLBACK")
    }

    /**
     * Begin a SQL transaction on the vault.
     */
    fun beginTransaction() {
        database.beginTransaction()
    }

    /**
     * Commit a SQL transaction on the vault.
     * This also atomically marks the vault as dirty and increments the mutation sequence
     * for proper sync tracking.
     */
    fun commitTransaction() {
        database.commitTransaction()

        // Atomically mark vault as dirty and increment mutation sequence
        // This ensures sync can properly detect local changes
        metadata.setIsDirty(true)
        metadata.incrementMutationSequence()
    }

    /**
     * Rollback a SQL transaction on the vault.
     */
    fun rollbackTransaction() {
        database.rollbackTransaction()
    }

    /**
     * Persist the in-memory database to encrypted storage and mark as dirty.
     * Used after migrations where SQL handles its own transactions but we need to persist and sync.
     * This does NOT commit any SQL transaction - it just persists the current state of the database.
     */
    fun persistAndMarkDirty() {
        database.persistDatabaseToEncryptedStorage()

        // Atomically mark vault as dirty and increment mutation sequence
        // This ensures sync can properly detect local changes
        metadata.setIsDirty(true)
        metadata.incrementMutationSequence()
    }

    /**
     * Get all items from the vault.
     */
    fun getAllItems(): List<Item> {
        return itemRepository.getAll()
    }

    /**
     * Attempts to get all items using only the cached encryption key.
     */
    fun tryGetAllItems(callback: ItemOperationCallback): Boolean {
        if (crypto.encryptionKey == null) {
            android.util.Log.d(TAG, "Encryption key not in memory, authentication required")
            return false
        }

        try {
            if (!database.isVaultUnlocked()) {
                unlockVault()
            }

            callback.onSuccess(itemRepository.getAll())
            return true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Error retrieving items", e)
            callback.onError(e)
            return false
        }
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

        if (!wasBiometricEnabled && isBiometricEnabled && crypto.encryptionKey != null && keystoreProvider.isBiometricAvailable()) {
            try {
                crypto.storeEncryptionKey(
                    android.util.Base64.encodeToString(crypto.encryptionKey, android.util.Base64.NO_WRAP),
                    authMethods,
                )
            } catch (e: Exception) {
                android.util.Log.d(
                    TAG,
                    "Could not persist encryption key immediately (likely no Activity context), will persist on next unlock: ${e.message}",
                )
            }
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
     * Get the sync state.
     */
    fun getSyncState(): net.aliasvault.app.vaultstore.models.SyncState {
        return metadata.getSyncState()
    }

    /**
     * Set the isDirty flag.
     */
    fun setIsDirty(isDirty: Boolean) {
        metadata.setIsDirty(isDirty)
    }

    /**
     * Set the isSyncing flag.
     */
    fun setIsSyncing(isSyncing: Boolean) {
        metadata.setIsSyncing(isSyncing)
    }

    /**
     * Store encrypted vault with sync state atomically.
     * Two modes:
     * 1. markDirty=true: Local mutation - always succeeds, increments mutation sequence
     * 2. expectedMutationSeq provided: Sync operation - only succeeds if no mutations happened
     */
    fun storeEncryptedVaultWithSyncState(
        encryptedVault: String,
        markDirty: Boolean = false,
        serverRevision: Int? = null,
        expectedMutationSeq: Int? = null,
    ): StoreVaultResult {
        var mutationSequence = metadata.getMutationSequence()

        // Race detection for sync operations
        if (expectedMutationSeq != null && expectedMutationSeq != mutationSequence) {
            return StoreVaultResult(success = false, mutationSequence = mutationSequence)
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

        return StoreVaultResult(success = true, mutationSequence = mutationSequence)
    }

    /**
     * Mark the vault as clean after successful sync.
     */
    fun markVaultClean(mutationSeqAtStart: Int, newServerRevision: Int): Boolean {
        return metadata.markVaultClean(mutationSeqAtStart, newServerRevision)
    }

    /**
     * Upload the vault to the server.
     */
    suspend fun uploadVault(webApiService: net.aliasvault.app.webapi.WebApiService): VaultUploadResult {
        return mutate.uploadVault(webApiService)
    }

    /**
     * Fetch the server vault (encrypted blob).
     */
    suspend fun fetchServerVault(webApiService: net.aliasvault.app.webapi.WebApiService): VaultResponse {
        return sync.fetchServerVault(webApiService)
    }

    /**
     * Check vault version including sync state.
     */
    suspend fun checkVaultVersion(webApiService: net.aliasvault.app.webapi.WebApiService): VaultVersionCheckResult {
        return sync.checkVaultVersion(webApiService)
    }

    /**
     * Unified vault sync method that handles all sync scenarios.
     */
    suspend fun syncVaultWithServer(webApiService: net.aliasvault.app.webapi.WebApiService): VaultSyncResult {
        val result = sync.syncVaultWithServer(webApiService)
        // Re-unlock vault if it was unlocked before sync and action was download/merge
        if (result.success && (result.action == SyncAction.DOWNLOADED || result.action == SyncAction.MERGED) && isVaultUnlocked()) {
            unlockVault()
        }
        return result
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
     * Get all passkeys for an item.
     */
    @Suppress("UnusedParameter")
    fun getPasskeysForItem(
        itemId: java.util.UUID,
        db: io.requery.android.database.sqlite.SQLiteDatabase,
    ): List<net.aliasvault.app.vaultstore.models.Passkey> {
        return passkey.getPasskeysForItem(itemId)
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
    ): List<net.aliasvault.app.vaultstore.repositories.PasskeyWithCredentialInfo> {
        return passkey.getPasskeysWithCredentialInfo(rpId, userName, userId)
    }

    /**
     * Get all passkeys with their associated items in a single query.
     */
    fun getAllPasskeysWithItems(): List<net.aliasvault.app.vaultstore.repositories.PasskeyWithItem> {
        return passkey.getAllPasskeysWithItems()
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
     * Create an item with a passkey.
     */
    fun createItemWithPasskey(
        rpId: String,
        userName: String?,
        displayName: String,
        passkeyObj: net.aliasvault.app.vaultstore.models.Passkey,
        logo: ByteArray? = null,
    ): net.aliasvault.app.vaultstore.models.Item {
        return passkey.createItemWithPasskey(rpId, userName, displayName, passkeyObj, logo)
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

    /**
     * Get Items that match an rpId but don't have a passkey yet.
     * Used for finding existing credentials that could have a passkey added to them.
     */
    fun getItemsWithoutPasskeyForRpId(
        rpId: String,
        rpName: String? = null,
        userName: String? = null,
    ): List<net.aliasvault.app.vaultstore.repositories.ItemWithCredentialInfo> {
        return passkey.getItemsWithoutPasskeyForRpId(rpId, rpName, userName)
    }

    /**
     * Add a passkey to an existing Item (merge passkey into existing credential).
     */
    fun addPasskeyToExistingItem(
        itemId: java.util.UUID,
        passkeyObj: net.aliasvault.app.vaultstore.models.Passkey,
        logo: ByteArray? = null,
    ) {
        passkey.addPasskeyToExistingItem(itemId, passkeyObj, logo)
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
     * Clear session data only (for forced logout).
     * Preserves vault data on disk for recovery on next login.
     * This is used when the user is forcibly logged out (e.g., 401, token revocation)
     * to allow recovery of unsynced local changes.
     */
    fun clearSession() {
        cache.clearSession()
    }

    /**
     * Clear all vault data including from persisted storage.
     * This is used for user-initiated logout where they explicitly
     * choose to clear all local data.
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

    // region Re-authentication

    /**
     * Authenticate the user using biometric authentication only.
     * Note: This method only handles biometric authentication.
     * Returns true if authentication succeeded, false otherwise.
     *
     * @param title The title for authentication. Optional, defaults to "Unlock Vault".
     * @return True if biometric authentication succeeded, false if authentication failed.
     */
    suspend fun issueBiometricAuthentication(title: String?): Boolean {
        // Use title if provided, otherwise default
        val authReason = title?.takeIf { it.isNotEmpty() } ?: "Unlock Vault"

        // Check if biometric authentication is enabled
        val authMethods = auth.getAuthMethods()
        val isBiometricEnabled = authMethods.contains("faceid")

        if (!isBiometricEnabled) {
            Log.e(TAG, "No authentication method enabled")
            return false
        }

        // Check if biometric is available
        if (!keystoreProvider.isBiometricAvailable()) {
            Log.e(TAG, "Biometric authentication not available")
            return false
        }

        // Trigger biometric authentication with a custom prompt
        return suspendCancellableCoroutine { continuation ->
            keystoreProvider.authenticateWithBiometric(
                authReason,
                object : BiometricAuthCallback {
                    override fun onSuccess() {
                        continuation.resume(true)
                    }

                    override fun onFailure() {
                        continuation.resume(false)
                    }
                },
            )
        }
    }

    // endregion
}
