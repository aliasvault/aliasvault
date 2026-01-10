package net.aliasvault.app.vaultstore

import android.util.Base64
import android.util.Log
import com.lambdapioneer.argon2kt.Argon2Kt
import com.lambdapioneer.argon2kt.Argon2Mode
import com.lambdapioneer.argon2kt.Argon2Version
import net.aliasvault.app.vaultstore.interfaces.CryptoOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreProvider
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import org.json.JSONObject
import java.math.BigInteger
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

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
         * Raw AES-GCM encryption (for VaultMergeService).
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
         * Raw AES-GCM decryption (for VaultMergeService).
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
     * The encryption key.
     */
    internal var encryptionKey: ByteArray? = null

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
        require(encryptionType == "Argon2Id") { "Unsupported encryption type: $encryptionType" }

        val settings = JSONObject(encryptionSettings)
        val iterations = settings.getInt("Iterations")
        val memorySize = settings.getInt("MemorySize")
        val parallelism = settings.getInt("DegreeOfParallelism")

        val argon2 = Argon2Kt()

        val hashResult = argon2.hash(
            mode = Argon2Mode.ARGON2_ID,
            password = password.toByteArray(Charsets.UTF_8),
            salt = salt.toByteArray(Charsets.UTF_8),
            tCostInIterations = iterations,
            mCostInKibibyte = memorySize,
            parallelism = parallelism,
            hashLengthInBytes = 32,
            version = Argon2Version.V13,
        )

        return hashResult.rawHashAsByteArray()
    }

    // endregion

    // region Encryption Key Management

    /**
     * Store the encryption key.
     */
    fun storeEncryptionKey(base64EncryptionKey: String, authMethods: String) {
        this.encryptionKey = Base64.decode(base64EncryptionKey, Base64.NO_WRAP)

        if (authMethods.contains(BIOMETRICS_AUTH_METHOD) && keystoreProvider.isBiometricAvailable()) {
            val latch = java.util.concurrent.CountDownLatch(1)
            var error: Exception? = null

            keystoreProvider.storeKey(
                key = base64EncryptionKey,
                object : KeystoreOperationCallback {
                    override fun onSuccess(result: String) {
                        Log.d(TAG, "Encryption key stored successfully with biometric protection")
                        latch.countDown()
                    }

                    override fun onError(e: Exception) {
                        Log.e(TAG, "Error storing encryption key with biometric protection", e)
                        error = e
                        latch.countDown()
                    }
                },
            )

            latch.await()
            error?.let { throw it }
        }
    }

    /**
     * Initialize the encryption key.
     */
    fun initEncryptionKey(base64EncryptionKey: String) {
        this.encryptionKey = Base64.decode(base64EncryptionKey, Base64.NO_WRAP)
    }

    /**
     * Store the encryption key derivation parameters.
     */
    fun storeEncryptionKeyDerivationParams(keyDerivationParams: String) {
        storageProvider.setKeyDerivationParams(keyDerivationParams)
    }

    /**
     * Get the encryption key derivation parameters.
     */
    fun getEncryptionKeyDerivationParams(): String {
        return storageProvider.getKeyDerivationParams()
    }

    /**
     * Check if biometric authentication is enabled and available.
     */
    fun isBiometricAuthEnabled(authMethods: String): Boolean {
        return authMethods.contains(BIOMETRICS_AUTH_METHOD) && keystoreProvider.isBiometricAvailable()
    }

    /**
     * Get the encryption key.
     */
    fun getEncryptionKey(callback: CryptoOperationCallback, authMethods: String) {
        encryptionKey?.let {
            callback.onSuccess(Base64.encodeToString(it, Base64.NO_WRAP))
            return
        }

        if (isBiometricAuthEnabled(authMethods)) {
            keystoreProvider.retrieveKey(
                object : KeystoreOperationCallback {
                    override fun onSuccess(result: String) {
                        try {
                            encryptionKey = Base64.decode(result, Base64.NO_WRAP)
                            callback.onSuccess(result)
                        } catch (e: Exception) {
                            Log.e(TAG, "Error decoding retrieved key", e)
                            callback.onError(e)
                        }
                    }

                    override fun onError(e: Exception) {
                        Log.e(TAG, "Error retrieving key", e)
                        callback.onError(e)
                    }
                },
            )
        } else {
            callback.onError(Exception("No encryption key found"))
        }
    }

    /**
     * Clear the encryption key from memory.
     */
    fun clearKey() {
        encryptionKey = null
    }

    // endregion

    // region Encryption/Decryption

    /**
     * Decrypt data.
     */
    fun decryptData(encryptedData: String, authMethods: String): String {
        var decryptedResult: String? = null
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

                        val decrypted = cipher.doFinal(encryptedContent)
                        decryptedResult = String(decrypted, Charsets.UTF_8)
                    } catch (e: Exception) {
                        error = e
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
     * Encrypt data.
     */
    fun encryptData(data: String): String {
        try {
            val iv = ByteArray(12)
            SecureRandom().nextBytes(iv)

            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val keySpec = SecretKeySpec(encryptionKey!!, "AES")
            val gcmSpec = GCMParameterSpec(128, iv)

            cipher.init(Cipher.ENCRYPT_MODE, keySpec, gcmSpec)

            val encrypted = cipher.doFinal(data.toByteArray(Charsets.UTF_8))

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
     * Encrypts the vault's encryption key using an RSA public key for mobile login.
     */
    fun encryptDecryptionKeyForMobileLogin(publicKeyJWK: String, authMethods: String): String {
        var result: String? = null
        var error: Exception? = null
        val latch = java.util.concurrent.CountDownLatch(1)

        getEncryptionKey(
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
