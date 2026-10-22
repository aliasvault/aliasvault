package net.aliasvault.app.vaultstore

import android.util.Base64
import android.util.Log
import net.aliasvault.app.vaultstore.interfaces.CryptoOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreProvider
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import org.json.JSONObject
import uniffi.aliasvault_core.KeyChainException
import uniffi.aliasvault_core.mobileLoginEncryptAccountKey as rustMobileLoginEncryptAccountKey
import uniffi.aliasvault_core.openAccountKeyChain as rustOpenAccountKeyChain
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
     * What the Account Key opens in the cached account key chain; a legacy key converts (see [LegacyKeyConversion]).
     */
    @Suppress("SwallowedException")
    private fun sessionKeys(): SessionKeys? {
        val key = accountKey ?: return null
        return try {
            openAccountKeyChain(key).also { if (!it.accountKey.contentEquals(key)) accountKey = it.accountKey }
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
     * Open a session with the unlock key or the Account Key and optionally persist the Account Key to keystore if
     * biometrics are enabled.
     *
     * During login, if biometrics are enabled, this will attempt to persist the key to keystore.
     * However, if Activity context is not available (common during login before UI is fully ready),
     * the key will only be stored in memory. It will be persisted to keystore on next unlock
     * when Activity context is available.
     */
    fun storeAccountKey(base64Key: String, authMethods: String) {
        openSession(Base64.decode(base64Key, Base64.NO_WRAP))

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
     * Open a session in memory only with the unlock key or the Account Key.
     */
    fun storeAccountKeyInMemory(base64Key: String) {
        openSession(Base64.decode(base64Key, Base64.NO_WRAP))
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
     * Open the cached account key chain with the Account Key or the unlock key (Rust `openAccountKeyChain`).
     */
    fun openAccountKeyChain(key: ByteArray): SessionKeys {
        val chainJson = getAccountKeyChain() ?: return SessionKeys(key, null, key)
        val chain = JSONObject(chainJson)
        val encryptedAccountKey = chain.optString("encryptedAccountKey").takeIf { it.isNotEmpty() } ?: return SessionKeys(key, null, key)
        val encryptedVek = chain.optString("encryptedVek").takeIf { it.isNotEmpty() } ?: error("Account key chain is missing the encrypted VEK")
        // A private key that does not open must not fail the unlock; grants stay closed until the next login.
        val encryptedPrivateKey = chain.optString("encryptedAccountPrivateKey").takeIf { it.isNotEmpty() }

        val keys = try {
            rustOpenAccountKeyChain(key, encryptedAccountKey, encryptedVek, encryptedPrivateKey)
        } catch (e: KeyChainException.UnlockKeyRejected) {
            throw AppError.UnlockKeyRejected(cause = e)
        } catch (e: KeyChainException.KeyChainUnreadable) {
            // The account key opened, so this is a damaged chain and never a wrong password.
            throw AppError.KeyChainUnreadable(e.message ?: "decrypt failed", e)
        }
        return SessionKeys(keys.vaultEncryptionKey, keys.accountPrivateKey, keys.accountKey)
    }

    /**
     * Open a session with a key that opens the cached account key chain; the session keeps the Account Key it yields.
     */
    fun openSession(key: ByteArray) {
        accountKey = openAccountKeyChain(key).accountKey
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
                            openSession(keystoreKey)
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
