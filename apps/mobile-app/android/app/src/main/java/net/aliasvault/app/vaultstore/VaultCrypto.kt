package net.aliasvault.app.vaultstore

import android.util.Base64
import android.util.Log
import net.aliasvault.app.vaultstore.interfaces.CryptoOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreProvider
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import org.json.JSONObject
import uniffi.aliasvault_core.KeyChainException
import java.math.BigInteger
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import uniffi.aliasvault_core.openAccountKeyChain as rustOpenAccountKeyChain

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

        /**
         * Raw AES-GCM encryption with a caller-supplied key.
         * Encrypts data using AES-256-GCM with a provided key.
         */
        fun encrypt(data: ByteArray, key: ByteArray): ByteArray {
            require(key.size == 32) { "Encryption key must be 32 bytes (256 bits)" }

            // Generate a random 12-byte nonce (IV)
            val nonce = ByteArray(12)
            SecureRandom().nextBytes(nonce)

            // Create cipher
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val secretKey = SecretKeySpec(key, "AES")
            val gcmSpec = GCMParameterSpec(128, nonce) // 128-bit auth tag

            // Encrypt
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, gcmSpec)
            val ciphertext = cipher.doFinal(data)

            // Return: nonce + ciphertext + tag (tag is included in ciphertext by GCM)
            return nonce + ciphertext
        }

        /**
         * Raw AES-GCM decryption with a caller-supplied key.
         * Decrypts data using AES-256-GCM with a provided key.
         */
        fun decrypt(encryptedData: ByteArray, key: ByteArray): ByteArray {
            require(key.size == 32) { "Decryption key must be 32 bytes (256 bits)" }
            require(encryptedData.size >= 12) { "Encrypted data too short" }

            // Extract nonce (first 12 bytes) and ciphertext (rest)
            val nonce = encryptedData.sliceArray(0 until 12)
            val ciphertext = encryptedData.sliceArray(12 until encryptedData.size)

            // Create cipher
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val secretKey = SecretKeySpec(key, "AES")
            val gcmSpec = GCMParameterSpec(128, nonce)

            // Decrypt
            cipher.init(Cipher.DECRYPT_MODE, secretKey, gcmSpec)
            return cipher.doFinal(ciphertext)
        }
    }

    /**
     * The stored key: the one secret the unlocked session holds in memory, and the key the unlock methods (keystore,
     * PIN) protect. Every other key is derived from it and the cached account key chain.
     */
    internal var unlockKey: ByteArray? = null

    /**
     * The encryption key for the vault, derived from the unlock key. Null while the vault is locked.
     */
    internal val encryptionKey: ByteArray?
        get() = sessionKeys()?.vaultEncryptionKey

    /**
     * The account private key (JWK) of the unlocked session, derived from the unlock key.
     */
    internal val accountPrivateKey: String?
        get() = sessionKeys()?.accountPrivateKey

    /**
     * What the stored key opens in the cached account key chain. A session that still holds an unlock key while the
     * account has a chain (a sync accepted one created on another device) keeps the Account Key from now on; the
     * keystore copy converts at the next biometric unlock (see [LegacyKeyConversion]), so this never prompts.
     */
    @Suppress("SwallowedException")
    private fun sessionKeys(): SessionKeys? {
        val key = unlockKey ?: return null
        return try {
            openAccountKeyChain(key).also { if (!it.accountKey.contentEquals(key)) unlockKey = it.accountKey }
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
     * Open a session with the unlock key and optionally persist that key to keystore if
     * biometrics are enabled.
     *
     * During login, if biometrics are enabled, this will attempt to persist the key to keystore.
     * However, if Activity context is not available (common during login before UI is fully ready),
     * the key will only be stored in memory. It will be persisted to keystore on next unlock
     * when Activity context is available.
     */
    fun storeUnlockKey(base64UnlockKey: String, authMethods: String) {
        openSession(Base64.decode(base64UnlockKey, Base64.NO_WRAP))

        if (authMethods.contains(BIOMETRICS_AUTH_METHOD)) {
            try {
                val latch = java.util.concurrent.CountDownLatch(1)
                var error: Exception? = null

                keystoreProvider.storeKey(
                    key = Base64.encodeToString(unlockKey, Base64.NO_WRAP),
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
     * Open a session in memory only with the unlock key.
     */
    fun storeUnlockKeyInMemory(base64UnlockKey: String) {
        openSession(Base64.decode(base64UnlockKey, Base64.NO_WRAP))
    }

    /**
     * Clear the unlock key from memory.
     * This forces getEncryptionKey() to fetch the unlock key from keystore on next biometric access.
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

    /*
     * The stored key is the one secret a session holds; keystore and PIN only protect that same key. It is the Account
     * Key, so it does not depend on the password: a typed password yields an unlock key (its Argon2id output), which
     * opening the chain turns into the Account Key before anything stores it. A key stored before the account had a
     * chain is an unlock key; it still opens the chain and is replaced by the Account Key on the next open. The
     * Account Key opens the vault key and account private key, which are derived on demand and never stored.
     */

    /**
     * The session keys the account key chain gives.
     *
     * @property vaultEncryptionKey The key that encrypts and decrypts the vault
     * @property accountPrivateKey The account private key (JWK), null when the account has no keypair
     * @property accountKey The key to store for later unlocks, in place of the key the chain was opened with
     */
    class SessionKeys(val vaultEncryptionKey: ByteArray, val accountPrivateKey: String?, val accountKey: ByteArray)

    /**
     * Open the cached account key chain with the stored key: the Account Key, or an unlock key that `accountKey` then
     * replaces (Rust `openAccountKeyChain`). Without a chain (account not yet upgraded) the unlock key is the vault key.
     */
    fun openAccountKeyChain(storedKey: ByteArray): SessionKeys {
        val chainJson = getAccountKeyChain() ?: return SessionKeys(storedKey, null, storedKey)
        val chain = JSONObject(chainJson)
        val encryptedAccountKey = chain.optString("encryptedAccountKey").takeIf { it.isNotEmpty() } ?: return SessionKeys(storedKey, null, storedKey)
        val encryptedVek = chain.optString("encryptedVek").takeIf { it.isNotEmpty() } ?: error("Account key chain is missing the encrypted VEK")
        // A private key that does not open must not fail the unlock; grants stay closed until the next login.
        val encryptedPrivateKey = chain.optString("encryptedAccountPrivateKey").takeIf { it.isNotEmpty() }

        val keys = try {
            rustOpenAccountKeyChain(storedKey, encryptedAccountKey, encryptedVek, encryptedPrivateKey)
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
    fun openSession(unlockKey: ByteArray) {
        this.unlockKey = openAccountKeyChain(unlockKey).accountKey
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
     * Get the unlock key, the keystore and PIN protect.
     */
    fun getUnlockKey(callback: CryptoOperationCallback, authMethods: String) {
        withSession(callback, authMethods) { unlockKey }
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
                            unlockKey?.let { LegacyKeyConversion.convertKeystoreKey(keystoreProvider, keystoreKey, it) }
                            callback.onSuccess(Base64.encodeToString(key(), Base64.NO_WRAP))
                        } catch (e: AppError) {
                            Log.e(TAG, "The unlock key from the keystore does not open the account key chain", e)
                            callback.onError(e)
                        } catch (e: Exception) {
                            Log.e(TAG, "The unlock key from the keystore does not open the account key chain", e)
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
        unlockKey = null
    }

    // endregion

    // region Encryption/Decryption

    /**
     * Decrypt data to text.
     */
    fun decryptData(encryptedData: String, authMethods: String): String {
        return String(decryptDataBytes(encryptedData, authMethods), Charsets.UTF_8)
    }

    /**
     * Decrypt data to raw bytes.
     */
    fun decryptDataBytes(encryptedData: String, authMethods: String): ByteArray {
        var decryptedResult: ByteArray? = null
        var error: Exception? = null

        val latch = java.util.concurrent.CountDownLatch(1)

        getEncryptionKey(
            object : CryptoOperationCallback {
                override fun onSuccess(result: String) {
                    try {
                        val decoded = Base64.decode(encryptedData, Base64.NO_WRAP)

                        val iv = decoded.copyOfRange(0, 12)
                        val encryptedContent = decoded.copyOfRange(12, decoded.size)

                        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                        val keySpec = SecretKeySpec(encryptionKey!!, "AES")
                        val gcmSpec = GCMParameterSpec(128, iv)

                        cipher.init(Cipher.DECRYPT_MODE, keySpec, gcmSpec)

                        decryptedResult = cipher.doFinal(encryptedContent)
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
     * Encrypt text.
     */
    fun encryptData(data: String): String {
        return encryptBytes(data.toByteArray(Charsets.UTF_8))
    }

    /**
     * Encrypt raw bytes.
     */
    fun encryptBytes(data: ByteArray): String {
        try {
            val iv = ByteArray(12)
            SecureRandom().nextBytes(iv)

            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val keySpec = SecretKeySpec(encryptionKey!!, "AES")
            val gcmSpec = GCMParameterSpec(128, iv)

            cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec)

            val encrypted = cipher.doFinal(data)

            val result = ByteArray(iv.size + encrypted.size)
            System.arraycopy(iv, 0, result, 0, iv.size)
            System.arraycopy(encrypted, 0, result, iv.size, encrypted.size)

            return Base64.encodeToString(result, Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.e(TAG, "Error encrypting data", e)
            throw e
        }
    }

    // endregion

    // region Mobile Login

    /**
     * Encrypts the unlock key using an RSA public key for mobile login. The receiving
     * client opens the account key chain with it, exactly as after a password login.
     */
    fun encryptUnlockKeyForMobileLogin(publicKeyJWK: String, authMethods: String): String {
        var result: String? = null
        var error: Exception? = null
        val latch = java.util.concurrent.CountDownLatch(1)

        getUnlockKey(
            object : CryptoOperationCallback {
                override fun onSuccess(key: String) {
                    try {
                        val keyBytes = Base64.decode(key, Base64.NO_WRAP)
                        result = encryptWithPublicKey(keyBytes, publicKeyJWK)
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

    private fun encryptWithPublicKey(data: ByteArray, publicKeyJWK: String): String {
        val jwk = JSONObject(publicKeyJWK)
        val nStr = jwk.getString("n")
        val eStr = jwk.getString("e")

        val modulus = BigInteger(1, Base64.decode(nStr, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))
        val exponent = BigInteger(1, Base64.decode(eStr, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))

        val keySpec = java.security.spec.RSAPublicKeySpec(modulus, exponent)
        val keyFactory = java.security.KeyFactory.getInstance("RSA")
        val publicKey = keyFactory.generatePublic(keySpec)

        val cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
        cipher.init(Cipher.ENCRYPT_MODE, publicKey)

        val encryptedBytes = cipher.doFinal(data)
        return Base64.encodeToString(encryptedBytes, Base64.NO_WRAP)
    }

    // endregion
}
