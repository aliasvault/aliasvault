package net.aliasvault.app.vaultstore

import android.util.Base64
import android.util.Log
import net.aliasvault.app.vaultstore.interfaces.CryptoOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreProvider
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import org.json.JSONObject
import uniffi.aliasvault_core.KeyChainException
import uniffi.aliasvault_core.KeyChainKeys
import uniffi.aliasvault_core.mobileLoginEncryptAccountKey as rustMobileLoginEncryptAccountKey
import uniffi.aliasvault_core.openKeyChainWithAccountKey as rustOpenKeyChainWithAccountKey
import uniffi.aliasvault_core.openKeyChainWithUnlockKey as rustOpenKeyChainWithUnlockKey
import uniffi.aliasvault_core.vaultBlobDecrypt as rustVaultBlobDecrypt
import uniffi.aliasvault_core.vaultBlobEncrypt as rustVaultBlobEncrypt

/**
 * Handles encryption, decryption, and key management for the vault.
 */
class VaultCrypto(
    private val keystoreProvider: KeystoreProvider,
    private val storageProvider: StorageProvider,
) {
    companion object {
        private const val TAG = "VaultCrypto"
        private const val BIOMETRICS_AUTH_METHOD = "faceid"
    }

    /**
     * The Account Key the unlocked session holds and the keystore and PIN protect (see [LegacyKeyConversion]).
     */
    internal var accountKey: ByteArray? = null

    /**
     * The encryption key for the vault, derived from the Account Key. Null while the vault is locked.
     */
    internal val encryptionKey: ByteArray?
        get() = sessionKeys()?.vaultEncryptionKey

    /**
     * The account private key (JWK) of the unlocked session, derived from the Account Key.
     */
    internal val accountPrivateKey: String?
        get() = sessionKeys()?.accountPrivateKey

    /**
     * The Account Key of the unlocked session (base64), which the sync engine opens the signing key with.
     */
    internal val accountKeyBase64: String?
        get() = sessionKeys()?.accountKey?.let { Base64.encodeToString(it, Base64.NO_WRAP) }

    /**
     * What the session key opens in the cached account key chain. A session opened before the device had a chain holds
     * the unlock key; once a sync caches the chain it opens as such and the Account Key replaces it (see [LegacyKeyConversion]).
     */
    @Suppress("SwallowedException")
    private fun sessionKeys(): SessionKeys? {
        val key = accountKey ?: return null
        return try {
            // This legacy key conversion call can be removed once all clients have updated to 0.31.0+.
            LegacyKeyConversion.openStoredKey(this, key).also { if (!it.accountKey.contentEquals(key)) accountKey = it.accountKey }
        } catch (e: Exception) {
            null
        }
    }

    // region Key Derivation

    /**
     * Derive a key from a password using Argon2Id.
     */
    fun deriveKeyFromPassword(
        password: String,
        salt: String,
        encryptionType: String,
        encryptionSettings: String,
    ): ByteArray {
        // Both types derive the unlock key with Argon2id; they differ only in how the SRP input is made from it.
        require(encryptionType == "Argon2Id" || encryptionType == "Argon2IdHkdf") { "Unsupported encryption type: $encryptionType" }

        return uniffi.aliasvault_core.argon2DeriveKey(password, salt, encryptionSettings)
    }

    // endregion

    // region Encryption Key Management

    /**
     * Open a session with the Account Key a device unlock method restored and persist it to the keystore if biometrics
     * are enabled.
     */
    fun storeAccountKey(base64Key: String, authMethods: String) {
        storeAccountKeyInMemory(base64Key)
        persistAccountKeyIfBiometricsEnabled(authMethods)
    }

    /**
     * Open a session with the unlock key of a password login; the session keeps the Account Key the chain yields and,
     * when asked, persists it to the keystore if biometrics are enabled.
     */
    fun openSessionWithUnlockKey(base64Key: String, persistToKeystore: Boolean, authMethods: String) {
        accountKey = openKeyChainWithUnlockKey(Base64.decode(base64Key, Base64.NO_WRAP)).accountKey
        if (persistToKeystore) {
            persistAccountKeyIfBiometricsEnabled(authMethods)
        }
    }

    /**
     * Persist the session's Account Key to the biometric keystore when biometrics are enabled. Without an Activity
     * context (common during login before the UI is ready) the key stays in memory and is persisted on the next unlock.
     */
    private fun persistAccountKeyIfBiometricsEnabled(authMethods: String) {
        if (authMethods.contains(BIOMETRICS_AUTH_METHOD)) {
            try {
                val latch = java.util.concurrent.CountDownLatch(1)
                var error: Exception? = null

                keystoreProvider.storeKey(
                    key = Base64.encodeToString(accountKey, Base64.NO_WRAP),
                    object : KeystoreOperationCallback {
                        override fun onSuccess(result: String) {
                            Log.d(TAG, "Encryption key stored successfully with biometric protection")
                            latch.countDown()
                        }

                        override fun onError(e: Exception) {
                            Log.d(TAG, "Could not persist encryption key to keystore (likely no Activity context), will persist on next unlock: ${e.message}")
                            error = e
                            latch.countDown()
                        }
                    },
                )

                latch.await()

                if (error != null) {
                    Log.d(TAG, "Encryption key stored in memory only, biometric keystore persistence deferred")
                }
            } catch (e: Exception) {
                // Catch any unexpected errors during keystore operations
                Log.d(TAG, "Could not persist encryption key to keystore, stored in memory only: ${e.message}")
            }
        } else {
            Log.d(TAG, "Stored encryption key in memory only (biometrics not enabled or not available)")
        }
    }

    /**
     * Open a session in memory only with the Account Key a device unlock method restored.
     */
    fun storeAccountKeyInMemory(base64Key: String) {
        accountKey = openKeyChainWithAccountKey(Base64.decode(base64Key, Base64.NO_WRAP)).accountKey
    }

    /**
     * Open a session in memory with a key the keystore stored: the Account Key, or the unlock key of a store written
     * before the account had a key chain (see [LegacyKeyConversion]).
     */
    fun openSessionWithStoredKey(key: ByteArray) {
        // This legacy key conversion call can be removed once all clients have updated to 0.31.0+.
        accountKey = LegacyKeyConversion.openStoredKey(this, key).accountKey
    }

    /**
     * Clear the Account Key from memory.
     * This forces getEncryptionKey() to fetch the Account Key from keystore on next biometric access.
     */
    fun clearEncryptionKeyFromMemory() {
        clearKey()
    }

    /**
     * Store the encryption key derivation parameters.
     */
    fun storeUnlockKeyDerivationParams(keyDerivationParams: String) {
        storageProvider.setKeyDerivationParams(keyDerivationParams)
    }

    /**
     * Get the encryption key derivation parameters.
     */
    fun getUnlockKeyDerivationParams(): String {
        return storageProvider.getKeyDerivationParams()
    }

    /**
     * Store the account-key chain the native unlock opens: JSON with the Account Key wrapped by the
     * KEK derived from the unlock key ("encryptedAccountKey") and the VEK wrapped by the Account Key ("encryptedVek").
     * Null until the account is upgraded; its unlock key encrypts the vault directly.
     */
    fun storeAccountKeyChain(chainJson: String?) {
        storageProvider.setAccountKeyChain(chainJson?.takeIf { it.isNotEmpty() })
    }

    /**
     * The stored account-key chain JSON, or null until the account is upgraded.
     */
    fun getAccountKeyChain(): String? {
        return storageProvider.getAccountKeyChain()
    }

    /**
     * The session keys the account key chain gives.
     *
     * @property vaultEncryptionKey The key that encrypts and decrypts the vault
     * @property accountPrivateKey The account private key (JWK), null when the account has no keypair
     * @property accountKey The Account Key to keep, in place of the key the chain was opened with
     */
    class SessionKeys(val vaultEncryptionKey: ByteArray, val accountPrivateKey: String?, val accountKey: ByteArray)

    /**
     * The cached account key chain as the server sent it. [encryptedAccountPrivateKey] is null when the account has no
     * keypair; a private key that does not open must not fail the unlock, grants then stay closed.
     */
    private class CachedKeyChain(val encryptedAccountKey: String, val encryptedVek: String, val encryptedAccountPrivateKey: String?)

    /**
     * The cached account key chain, null for an account without one (its key is the vault key).
     */
    private fun cachedKeyChain(): CachedKeyChain? {
        val chain = JSONObject(getAccountKeyChain() ?: return null)
        val encryptedAccountKey = chain.optString("encryptedAccountKey").takeIf { it.isNotEmpty() } ?: return null
        val encryptedVek = chain.optString("encryptedVek").takeIf { it.isNotEmpty() } ?: error("Account key chain is missing the encrypted VEK")
        return CachedKeyChain(encryptedAccountKey, encryptedVek, chain.optString("encryptedAccountPrivateKey").takeIf { it.isNotEmpty() })
    }

    /**
     * Open the cached account key chain with the unlock key of a password login (Rust `openKeyChainWithUnlockKey`).
     * Other platform implementations: VaultStore.openKeyChainWithUnlockKey (iOS), VaultKeyService.openKeyChain (core/client).
     */
    fun openKeyChainWithUnlockKey(unlockKey: ByteArray): SessionKeys = openKeyChain(unlockKey) { chain ->
        rustOpenKeyChainWithUnlockKey(unlockKey, chain.encryptedAccountKey, chain.encryptedVek, chain.encryptedAccountPrivateKey)
    }

    /**
     * Open the cached account key chain with the Account Key (Rust `openKeyChainWithAccountKey`).
     * Other platform implementations: VaultStore.openKeyChainWithAccountKey (iOS), VaultKeyService.openKeyChain (core/client).
     */
    fun openKeyChainWithAccountKey(accountKey: ByteArray): SessionKeys = openKeyChain(accountKey) { chain ->
        rustOpenKeyChainWithAccountKey(accountKey, chain.encryptedVek, chain.encryptedAccountPrivateKey)
    }

    /**
     * Open the cached chain through [open]; without a chain [key] is the vault key. Either rejection is E-206, an
     * unreadable chain E-207 (the Account Key opened, so never a wrong password).
     */
    private fun openKeyChain(key: ByteArray, open: (CachedKeyChain) -> KeyChainKeys): SessionKeys {
        val chain = cachedKeyChain() ?: return SessionKeys(key, null, key)
        val keys = try {
            open(chain)
        } catch (e: KeyChainException.UnlockKeyRejected) {
            throw AppError.UnlockKeyRejected(cause = e)
        } catch (e: KeyChainException.AccountKeyRejected) {
            throw AppError.UnlockKeyRejected(cause = e)
        } catch (e: KeyChainException.KeyChainUnreadable) {
            throw AppError.KeyChainUnreadable(e.message ?: "decrypt failed", e)
        }
        return SessionKeys(keys.vaultEncryptionKey, keys.accountPrivateKey, keys.accountKey)
    }

    /**
     * Check if biometric authentication is enabled and available.
     */
    fun isBiometricAuthEnabled(authMethods: String): Boolean {
        return authMethods.contains(BIOMETRICS_AUTH_METHOD) && keystoreProvider.isBiometricAvailable()
    }

    /**
     * Get the encryption key, the key that encrypts and decrypts the vault.
     */
    fun getEncryptionKey(callback: CryptoOperationCallback, authMethods: String) {
        withSession(callback, authMethods) { encryptionKey }
    }

    /**
     * Get the Account Key, the key the keystore and PIN protect.
     */
    fun getAccountKey(callback: CryptoOperationCallback, authMethods: String) {
        withSession(callback, authMethods) { accountKey }
    }

    /**
     * Hand one of the session keys to the callback, opening the session from the keystore behind a biometric prompt
     * when none is open.
     */
    private fun withSession(callback: CryptoOperationCallback, authMethods: String, key: () -> ByteArray?) {
        key()?.let {
            callback.onSuccess(Base64.encodeToString(it, Base64.NO_WRAP))
            return
        }

        if (isBiometricAuthEnabled(authMethods)) {
            keystoreProvider.retrieveKey(
                object : KeystoreOperationCallback {
                    override fun onSuccess(result: String) {
                        try {
                            val keystoreKey = Base64.decode(result, Base64.NO_WRAP)
                            openSessionWithStoredKey(keystoreKey)
                            // This legacy key conversion call can be removed once all clients have updated to 0.31.0+.
                            accountKey?.let { LegacyKeyConversion.convertLegacyKeystoreKey(keystoreProvider, keystoreKey, it) }
                            callback.onSuccess(Base64.encodeToString(key(), Base64.NO_WRAP))
                        } catch (e: AppError) {
                            Log.e(TAG, "The Account Key from the keystore does not open the account key chain", e)
                            callback.onError(e)
                        } catch (e: Exception) {
                            Log.e(TAG, "The Account Key from the keystore does not open the account key chain", e)
                            callback.onError(AppError.UnlockKeyRejected(cause = e))
                        }
                    }

                    override fun onError(e: Exception) {
                        Log.e(TAG, "Error retrieving key", e)
                        // Pass through the error - AndroidKeystoreProvider now throws proper AppError types
                        callback.onError(e)
                    }
                },
            )
        } else {
            callback.onError(AppError.KeystoreKeyNotFound("No encryption key found in memory or keystore"))
        }
    }

    /**
     * Clear the encryption key from memory.
     */
    fun clearKey() {
        accountKey = null
    }

    // endregion

    // region Encryption/Decryption

    /**
     * Decrypt the stored vault blob (base64) into the SQLite database bytes. This can trigger biometric authentication.
     */
    fun decryptVaultBlob(encryptedBlob: String, authMethods: String): ByteArray {
        var decryptedResult: ByteArray? = null
        var error: Exception? = null

        val latch = java.util.concurrent.CountDownLatch(1)

        getEncryptionKey(
            object : CryptoOperationCallback {
                override fun onSuccess(result: String) {
                    try {
                        decryptedResult = rustVaultBlobDecrypt(encryptedBlob, encryptionKey!!)
                    } catch (e: Exception) {
                        error = AppError.VaultDecryptFailed(cause = e)
                        Log.e(TAG, "Error decrypting data", e)
                    } finally {
                        latch.countDown()
                    }
                }

                override fun onError(e: Exception) {
                    error = e
                    Log.e(TAG, "Error getting encryption key", e)
                    latch.countDown()
                }
            },
            authMethods,
        )

        latch.await()

        error?.let { throw it }
        return decryptedResult ?: error("Decryption failed")
    }

    /**
     * Encrypt the SQLite database bytes into the stored vault blob (base64).
     */
    fun encryptVaultBlob(sqliteBytes: ByteArray): String {
        return rustVaultBlobEncrypt(sqliteBytes, encryptionKey!!)
    }

    // endregion

    // region Mobile Login

    /**
     * Encrypts the Account Key using an RSA public key for mobile login. The receiving
     * client opens the account key chain with it, exactly as after a password login.
     */
    fun encryptAccountKeyForMobileLogin(publicKeyJWK: String, authMethods: String): String {
        var result: String? = null
        var error: Exception? = null
        val latch = java.util.concurrent.CountDownLatch(1)

        getAccountKey(
            object : CryptoOperationCallback {
                override fun onSuccess(key: String) {
                    try {
                        val keyBytes = Base64.decode(key, Base64.NO_WRAP)
                        result = rustMobileLoginEncryptAccountKey(keyBytes, publicKeyJWK)
                    } catch (e: Exception) {
                        error = e
                        Log.e(TAG, "Error encrypting key for mobile login", e)
                    } finally {
                        latch.countDown()
                    }
                }

                override fun onError(e: Exception) {
                    error = e
                    Log.e(TAG, "Error getting encryption key", e)
                    latch.countDown()
                }
            },
            authMethods,
        )

        latch.await()
        error?.let { throw it }
        return result ?: throw Exception("Failed to encrypt key for mobile login")
    }

    // endregion
}
