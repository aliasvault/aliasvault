package net.aliasvault.app.vaultstore

import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.suspendCancellableCoroutine
import net.aliasvault.app.vaultstore.interfaces.CryptoOperationCallback
import net.aliasvault.app.vaultstore.interfaces.ItemOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.BiometricAuthCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreProvider
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.StoreVaultResult
import net.aliasvault.app.vaultstore.models.TotpCode
import net.aliasvault.app.vaultstore.models.VaultMutationScope
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
         * Hard cap on how long a recent-auth grace will be honored, regardless of caller input.
         */
        private const val MAX_AUTH_RECENCY_WINDOW_SECONDS: Double = 15.0

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

    // region Authentication Recency

    /** Last successful biometric/PIN auth. */
    @Volatile
    private var lastSuccessfulAuthAtMs: Long? = null

    /** Mark successful authorization call to be used for future recency checks. */
    internal fun markSuccessfulAuth() {
        lastSuccessfulAuthAtMs = SystemClock.elapsedRealtime()
    }

    /**
     * Invalidate the recency timestamp. Must be called whenever the encryption key is cleared
     * (lock, sign-out, auto-lock) so the grace window cannot outlive the unlocked state.
     */
    internal fun clearLastSuccessfulAuth() {
        lastSuccessfulAuthAtMs = null
    }

    /**
     * Check if we're within the recency window for last successful auth attempt.
     */
    internal fun wasRecentlyAuthenticated(maxRecencySeconds: Double): Boolean {
        if (maxRecencySeconds <= 0.0) return false
        val effectiveWindow = minOf(maxRecencySeconds, MAX_AUTH_RECENCY_WINDOW_SECONDS)
        val last = lastSuccessfulAuthAtMs ?: return false
        return SystemClock.elapsedRealtime() - last < (effectiveWindow * 1000).toLong()
    }

    // endregion

    // region Composed Components

    private val crypto = VaultCrypto(keystoreProvider, storageProvider)
    internal val metadata = VaultMetadataManager(storageProvider)
    internal val database = VaultDatabase(storageProvider, crypto, metadata)
    private val itemRepository = net.aliasvault.app.vaultstore.repositories.ItemRepository(database)
    private val itemStatsRepository = net.aliasvault.app.vaultstore.repositories.ItemStatsRepository(database)
    private val auth = VaultAuth(
        storageProvider,
        onClearCache = {
            cache.clearCache()
            clearLastSuccessfulAuth()
        },
        onBackground = { clearLastSuccessfulAuth() },
    )
    private val sync = VaultSync(this, storageProvider)
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
    internal val encryptionKey: ByteArray?
        get() = crypto.encryptionKey

    /**
     * Internal accessor for VaultAuth.
     */
    internal val vaultAuth: VaultAuth
        get() = auth

    // endregion

    /** Point the keystore provider at the caller's foreground activity for biometric prompts. */
    fun setKeystoreActivityGetter(getter: () -> android.app.Activity?) {
        (keystoreProvider as? net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider)
            ?.setActivityGetter(getter)
    }

    // region Crypto Methods

    /**
     * Open a session with the unlock key and persist that key to keystore if biometrics
     * are enabled.
     */
    fun storeUnlockKey(base64UnlockKey: String) {
        crypto.storeUnlockKey(base64UnlockKey, auth.getAuthMethods())
    }

    /**
     * Open a session in memory only with the unlock key.
     */
    fun storeUnlockKeyInMemory(base64UnlockKey: String) {
        crypto.storeUnlockKeyInMemory(base64UnlockKey)
    }

    /**
     * Clear the encryption key from memory.
     * This forces getEncryptionKey() to fetch from keystore on next biometric access.
     */
    fun clearEncryptionKeyFromMemory() {
        crypto.clearEncryptionKeyFromMemory()
        clearLastSuccessfulAuth()
    }

    /**
     * Get the encryption key.
     */
    fun getEncryptionKey(callback: CryptoOperationCallback) {
        crypto.getEncryptionKey(callback, auth.getAuthMethods())
    }

    /**
     * Get the unlock key, the keystore and PIN protect.
     */
    fun getUnlockKey(callback: CryptoOperationCallback) {
        crypto.getUnlockKey(callback, auth.getAuthMethods())
    }

    /**
     * Answer a server's SRP challenge with the unlock key of the open session (see VaultCrypto.deriveSrpProof).
     */
    fun deriveSrpProof(salt: String, srpIdentity: String, serverEphemeral: String, callback: CryptoOperationCallback) {
        crypto.deriveSrpProof(salt, srpIdentity, serverEphemeral, callback, auth.getAuthMethods())
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
    fun storeUnlockKeyDerivationParams(keyDerivationParams: String) {
        crypto.storeUnlockKeyDerivationParams(keyDerivationParams)
    }

    /**
     * Get the encryption key derivation parameters.
     */
    fun getUnlockKeyDerivationParams(): String {
        return crypto.getUnlockKeyDerivationParams()
    }

    /**
     * Store the account-key chain the native password unlock unwraps (null for a legacy account).
     */
    fun storeAccountKeyChain(chainJson: String?) {
        crypto.storeAccountKeyChain(chainJson)
    }

    /**
     * Get the stored account-key chain JSON, or null for a legacy account.
     */
    fun getAccountKeyChain(): String? {
        return crypto.getAccountKeyChain()
    }

    /**
     * The account private key (JWK) of the unlocked session, derived from the unlock key; null for an account without a keypair.
     */
    internal val accountPrivateKey: String?
        get() = crypto.accountPrivateKey

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
     * Encrypts the unlock key using an RSA public key for mobile login.
     */
    fun encryptUnlockKeyForMobileLogin(publicKeyJWK: String): String {
        return crypto.encryptUnlockKeyForMobileLogin(publicKeyJWK, auth.getAuthMethods())
    }

    /**
     * Verify the password and return the unlock key if correct. Returns null if the
     * password is incorrect.
     *
     * @param password The password to verify
     * @return The base64-encoded unlock key if password is correct, null otherwise
     */
    @Suppress("SwallowedException")
    fun verifyPassword(password: String): String? {
        return try {
            // Get encryption key derivation parameters
            val params = crypto.getUnlockKeyDerivationParams()
            val paramsJson = org.json.JSONObject(params)
            val salt = paramsJson.getString("salt")
            val encryptionType = paramsJson.getString("encryptionType")
            val encryptionSettings = paramsJson.getString("encryptionSettings")

            // Derive the KEK from the password and unwrap the chain; a wrong password fails the unwrap.
            val derivedKey = crypto.deriveKeyFromPassword(password, salt, encryptionType, encryptionSettings)
            val vaultEncryptionKey = crypto.openAccountKeyChain(derivedKey).vaultEncryptionKey

            // Try to decrypt the vault to verify the password is correct
            val encryptedDb = database.getEncryptedDatabase()
            val encryptedDbBytes = android.util.Base64.decode(encryptedDb, android.util.Base64.NO_WRAP)

            // Attempt decryption to verify password is correct
            VaultCrypto.decrypt(encryptedDbBytes, vaultEncryptionKey)

            // If decryption succeeded, return the unlock key as base64
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
        // A nil-to-non-nil transition means the keystore just released the unlock key after biometric.
        val hadKeyInMemory = crypto.unlockKey != null
        database.unlockVault(auth.getAuthMethods())
        if (!hadKeyInMemory && crypto.unlockKey != null) {
            markSuccessfulAuth()
        }
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
        }

        return database.query(queryString, convertedParams)
    }

    /**
     * Execute an SQL update on the vault that mutates it.
     */
    fun executeUpdate(queryString: String, params: Array<Any?>): Int {
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

        return database.execute(queryString, processedParams)
    }

    /**
     * Execute a raw SQL script (one or more statements) on the vault without parameters.
     * Migration scripts handle their own transactions and PRAGMA statements.
     */
    fun executeRaw(queryString: String) {
        database.executeScript(queryString)
    }

    /**
     * Begin a SQL transaction on the vault.
     */
    fun beginTransaction() {
        database.beginTransaction()
    }

    /**
     * Commit a SQL transaction on the vault. The commit persists the vault and marks it dirty for the sync.
     * @param scope What the mutation touched, so the next sync can push only that scope
     */
    fun commitTransaction(scope: String = VaultMutationScope.MAIN) {
        database.commitTransaction(scope)
    }

    /**
     * Rollback a SQL transaction on the vault.
     */
    fun rollbackTransaction() {
        database.rollbackTransaction()
    }

    /**
     * Persist the in-memory database to encrypted storage and mark as dirty, without committing a SQL
     * transaction. Used after migrations whose scripts manage their own transactions.
     * @param scope What the mutation touched, so the next sync can push only that scope
     */
    fun persistAndMarkDirty(scope: String = VaultMutationScope.MAIN) {
        database.persistAndMarkDirty(scope)
    }

    /**
     * Get all items from the vault. Archived and trashed items are excluded, so this is safe to use
     * as the autofill candidate list.
     */
    fun getAllItems(): List<Item> {
        return itemRepository.getAll()
    }

    /**
     * Get the first non-deleted TOTP code for an item, or null when none exists.
     * Used by the autofill service to copy a credential's current TOTP code to
     * the clipboard at fill time.
     */
    fun getTotpForItem(itemId: String, manifestId: String): TotpCode? {
        if (!database.isVaultUnlocked()) {
            return null
        }
        return try {
            itemRepository.getTotpForItem(itemId, manifestId)
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Error getting TOTP code for item", e)
            null
        }
    }

    /**
     * Record one use of an item (autofill, copy or passkey assertion) in its usage statistics.
     * Persists the vault and marks it dirty, so the next sync pushes it.
     */
    fun recordItemUsage(itemId: String, manifestId: String, action: net.aliasvault.app.vaultstore.repositories.ItemUsageAction) {
        itemStatsRepository.recordUsage(itemId, manifestId, action)
    }

    /**
     * Attempts to get all items using only the unlock key held in memory.
     */
    fun tryGetAllItems(callback: ItemOperationCallback): Boolean {
        if (crypto.unlockKey == null) {
            android.util.Log.d(TAG, "Unlock key not in memory, authentication required")
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

        if (!wasBiometricEnabled && isBiometricEnabled) {
            try {
                crypto.storeUnlockKey(
                    android.util.Base64.encodeToString(crypto.unlockKey, android.util.Base64.NO_WRAP),
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
        scope: String = VaultMutationScope.MAIN,
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
            metadata.markDirty(scope)
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
     * The vault encryption key held in memory, as base64, or null while the vault is locked.
     */
    fun getEncryptionKeyBase64(): String? {
        return encryptionKey?.let { android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP) }
    }

    /**
     * Forget what the sync engine learned about the stored vault (revisions, fingerprints, key chain), so the next
     * sync starts from the server as if this device had never pulled. Used when the vault is discarded.
     */
    fun clearSyncEngineState() {
        storageProvider.clearSyncEngineState()
        crypto.storeAccountKeyChain(null)
    }

    /**
     * One status call: whether the server holds newer state than this device.
     */
    suspend fun checkVaultVersion(webApiService: net.aliasvault.app.webapi.WebApiService): VaultVersionCheckResult {
        return sync.checkVaultVersion(webApiService)
    }

    /**
     * Resolve and store the vault key right after login from the unlock key (see VaultSync.resolveVaultKey).
     */
    suspend fun resolveVaultKey(webApiService: net.aliasvault.app.webapi.WebApiService, derivedKeyBase64: String): String {
        return sync.resolveVaultKey(webApiService, derivedKeyBase64)
    }

    /**
     * Full vault sync through the Rust sync engine.
     */
    suspend fun syncVaultWithServer(webApiService: net.aliasvault.app.webapi.WebApiService): VaultSyncResult {
        return sync.syncVaultWithServer(webApiService)
    }

    /**
     * The logs of the recent sync engine runs as JSON text, newest first (developer tools).
     */
    fun getVaultSyncLogs(): String {
        return VaultSyncRunLog.persisted(storageProvider)
    }

    /**
     * Classify the pending manifest migration (see VaultSync.getVaultMigrationStatus).
     */
    suspend fun getVaultMigrationStatus(webApiService: net.aliasvault.app.webapi.WebApiService): String {
        return sync.getVaultMigrationStatus(webApiService)
    }

    /**
     * Run the pending manifest migration and push it (see VaultSync.migrateVaultManifest).
     */
    suspend fun migrateVaultManifest(webApiService: net.aliasvault.app.webapi.WebApiService): VaultMigrationResult {
        return sync.migrateVaultManifest(webApiService)
    }

    /**
     * Run a sharing operation of the sync engine (see VaultSync.runSharingOperation).
     */
    suspend fun runSharingOperation(
        operation: String,
        params: org.json.JSONObject,
        webApiService: net.aliasvault.app.webapi.WebApiService,
    ): VaultSharingResult {
        return sync.runSharingOperation(operation, params, webApiService)
    }

    // endregion

    // region Mutate Methods

    /**
     * Push the pending local changes (after a native mutation).
     */
    suspend fun mutateVault(webApiService: net.aliasvault.app.webapi.WebApiService): Boolean {
        return sync.mutateVault(webApiService)
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
    fun getPasskeysForItem(itemId: java.util.UUID, manifestId: String): List<net.aliasvault.app.vaultstore.models.Passkey> {
        return passkey.getPasskeysForItem(itemId, manifestId)
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
    fun getPasskeyById(passkeyId: java.util.UUID): net.aliasvault.app.vaultstore.models.Passkey? {
        return passkey.getPasskeyById(passkeyId)
    }

    /**
     * Create an item with a passkey. The url is written as the item's login URL and names the favicon's domain.
     */
    fun createItemWithPasskey(
        url: String,
        userName: String?,
        displayName: String,
        passkeyObj: net.aliasvault.app.vaultstore.models.Passkey,
        logo: ByteArray? = null,
    ): net.aliasvault.app.vaultstore.models.Item {
        return passkey.createItemWithPasskey(url, userName, displayName, passkeyObj, logo)
    }

    /**
     * Replace an existing passkey with a new one. The url names the domain the favicon was fetched for.
     */
    fun replacePasskey(
        oldPasskeyId: java.util.UUID,
        newPasskey: net.aliasvault.app.vaultstore.models.Passkey,
        displayName: String,
        url: String,
        logo: ByteArray? = null,
    ) {
        passkey.replacePasskey(oldPasskeyId, newPasskey, displayName, url, logo)
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
     * Add a passkey to an existing Item (merge passkey into existing credential). The url names the domain
     * the favicon was fetched for.
     */
    fun addPasskeyToExistingItem(
        itemId: java.util.UUID,
        manifestId: String,
        passkeyObj: net.aliasvault.app.vaultstore.models.Passkey,
        url: String,
        logo: ByteArray? = null,
    ) {
        passkey.addPasskeyToExistingItem(itemId, manifestId, passkeyObj, url, logo)
    }

    // endregion

    // region Cache Methods

    /**
     * Clear the memory, removing the encryption key and decrypted database from memory.
     */
    fun clearCache() {
        cache.clearCache()
        clearLastSuccessfulAuth()
    }

    /**
     * Clear session data only (for forced logout).
     * Preserves vault data on disk for recovery on next login.
     * This is used when the user is forcibly logged out (e.g., 401, token revocation)
     * to allow recovery of unsynced local changes.
     */
    fun clearSession() {
        cache.clearSession()
        clearLastSuccessfulAuth()
    }

    /**
     * Clear all vault data including from persisted storage.
     * This is used for user-initiated logout where they explicitly
     * choose to clear all local data.
     */
    fun clearVault() {
        cache.clearVault()
        clearLastSuccessfulAuth()
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
    fun setupPin(pinValue: String, unlockKeyBase64: String) {
        pin.setupPin(pinValue, unlockKeyBase64)
    }

    /**
     * Unlock with PIN. Returns the unlock key the PIN protects, to open the session with.
     */
    @Throws(Exception::class)
    fun unlockWithPin(pinValue: String): String {
        val key = pin.unlockWithPin(pinValue)
        markSuccessfulAuth()
        return key
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
