package net.aliasvault.app.vaultstore.keystoreprovider

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import net.aliasvault.app.R
import net.aliasvault.app.vaultstore.AppError
import java.io.File
import java.nio.ByteBuffer
import java.security.KeyStore
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Android implementation of the keystore provider that uses Android's Keystore and Biometric APIs.
 */
class AndroidKeystoreProvider(
    private val context: Context,
    private val getCurrentActivity: () -> Activity?,
) : KeystoreProvider {
    companion object {
        /**
         * The tag for logging.
         */
        private const val TAG = "AndroidKeystoreProvider"

        /**
         * The alias for the keystore.
         */
        private const val KEYSTORE_ALIAS = "alias_vault_key"

        /**
         * The filename for the encrypted key.
         */
        private const val ENCRYPTED_KEY_FILE = "encrypted_vault_key"
    }

    /**
     * The biometric manager.
     */
    private val _biometricManager = BiometricManager.from(context)

    /**
     * The executor.
     */
    private val _executor: Executor = Executors.newSingleThreadExecutor()

    /**
     * The main handler.
     */
    private val _mainHandler = Handler(Looper.getMainLooper())

    /**
     * Whether the biometric is available.
     * @return Whether the biometric is available
     */
    override fun isBiometricAvailable(): Boolean {
        return _biometricManager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_WEAK or
                BiometricManager.Authenticators.BIOMETRIC_STRONG or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL,
        ) == BiometricManager.BIOMETRIC_SUCCESS
    }

    /**
     * Store the key in the keystore.
     * @param key The key to store
     * @param callback The callback to call when the operation is complete
     */
    override fun storeKey(key: String, callback: KeystoreOperationCallback) {
        _mainHandler.post {
            try {
                val currentActivity = getCurrentActivity()
                if (currentActivity == null || !(currentActivity is FragmentActivity)) {
                    callback.onError(
                        Exception("No activity available for biometric authentication"),
                    )
                    return@post
                }

                // Set up KeyStore
                val keyStore = KeyStore.getInstance("AndroidKeyStore")
                keyStore.load(null)

                // Create or get biometric key
                if (!keyStore.containsAlias(KEYSTORE_ALIAS)) {
                    val keyGenerator = KeyGenerator.getInstance(
                        KeyProperties.KEY_ALGORITHM_AES,
                        "AndroidKeyStore",
                    )

                    val keySpecBuilder = KeyGenParameterSpec.Builder(
                        KEYSTORE_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setUserAuthenticationRequired(true)
                        .setInvalidatedByBiometricEnrollment(true)

                    // Require strong biometric authentication per crypto operation
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        keySpecBuilder.setUserAuthenticationParameters(
                            0,
                            KeyProperties.AUTH_BIOMETRIC_STRONG,
                        )
                    } else {
                        @Suppress("DEPRECATION")
                        keySpecBuilder.setUserAuthenticationValidityDurationSeconds(-1)
                    }

                    keyGenerator.init(keySpecBuilder.build())
                    keyGenerator.generateKey()
                }

                val secretKey = keyStore.getKey(KEYSTORE_ALIAS, null) as SecretKey

                // Initialize cipher for CryptoObject binding
                val cipher = Cipher.getInstance(
                    "${KeyProperties.KEY_ALGORITHM_AES}/" +
                        "${KeyProperties.BLOCK_MODE_GCM}/" +
                        KeyProperties.ENCRYPTION_PADDING_NONE,
                )

                try {
                    cipher.init(Cipher.ENCRYPT_MODE, secretKey)
                } catch (e: KeyPermanentlyInvalidatedException) {
                    Log.w(TAG, "Key permanently invalidated, clearing keys", e)
                    keyStore.deleteEntry(KEYSTORE_ALIAS)
                    File(context.filesDir, ENCRYPTED_KEY_FILE).delete()
                    callback.onError(
                        Exception(
                            "Biometric enrollment changed. " +
                                "Please sign in with your password to re-enable biometric unlock.",
                            e,
                        ),
                    )
                    return@post
                }

                val promptInfo = BiometricPrompt.PromptInfo.Builder()
                    .setTitle(context.getString(R.string.biometric_store_key_title))
                    .setSubtitle(context.getString(R.string.biometric_store_key_subtitle))
                    .setNegativeButtonText(context.getString(R.string.common_cancel))
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .build()

                val biometricPrompt = BiometricPrompt(
                    currentActivity,
                    _executor,
                    object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(
                            result: BiometricPrompt.AuthenticationResult,
                        ) {
                            try {
                                val authenticatedCipher = result.cryptoObject?.cipher
                                    ?: error("Cipher is null after authentication")
                                val encryptedKey = authenticatedCipher.doFinal(key.toByteArray())
                                val iv = authenticatedCipher.iv
                                val byteBuffer = ByteBuffer.allocate(iv.size + encryptedKey.size)
                                byteBuffer.put(iv)
                                byteBuffer.put(encryptedKey)
                                val combined = byteBuffer.array()
                                val encryptedKeyB64 = Base64.encodeToString(
                                    combined,
                                    Base64.NO_WRAP,
                                )
                                val keyFile = File(context.filesDir, ENCRYPTED_KEY_FILE)
                                keyFile.writeText(encryptedKeyB64)

                                callback.onSuccess("Key stored successfully")
                            } catch (e: Exception) {
                                Log.e(TAG, "Error storing encryption key", e)
                                callback.onError(
                                    Exception("Failed to store encryption key: ${e.message}"),
                                )
                            }
                        }

                        override fun onAuthenticationError(
                            errorCode: Int,
                            errString: CharSequence,
                        ) {
                            Log.e(TAG, "Authentication error: $errorCode - $errString")
                            val error = when (errorCode) {
                                BiometricPrompt.ERROR_USER_CANCELED,
                                BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                                BiometricPrompt.ERROR_CANCELED,
                                -> AppError.BiometricCancelled(
                                    "Biometric authentication cancelled: $errString",
                                )
                                else -> AppError.BiometricFailed(
                                    "Biometric authentication error: $errString (code: $errorCode)",
                                )
                            }
                            callback.onError(error)
                        }

                        override fun onAuthenticationFailed() {
                            Log.e(TAG, "Authentication failed")
                        }
                    },
                )

                biometricPrompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))
            } catch (e: Exception) {
                Log.e(TAG, "Error in biometric key storage", e)
                callback.onError(AppError.BiometricFailed("Failed to initialize key storage: ${e.message}", e))
            }
        }
    }

    override fun retrieveKey(callback: KeystoreOperationCallback) {
        _mainHandler.post {
            try {
                val currentActivity = getCurrentActivity()
                if (currentActivity == null || !(currentActivity is FragmentActivity)) {
                    callback.onError(
                        Exception("No activity available for biometric authentication"),
                    )
                    return@post
                }

                retrieveKeyInternalLogic(currentActivity, callback)
            } catch (e: Exception) {
                Log.e(TAG, "Error in biometric key retrieval", e)
                callback.onError(e)
            }
        }
    }

    override fun retrieveKeyExternal(activity: FragmentActivity, callback: KeystoreOperationCallback) {
        _mainHandler.post {
            try {
                retrieveKeyInternalLogic(activity, callback)
            } catch (e: Exception) {
                Log.e(TAG, "Error in external biometric key retrieval", e)
                callback.onError(e)
            }
        }
    }

    override fun clearKeys() {
        try {
            // Clear from private file storage
            val keyFile = File(context.filesDir, ENCRYPTED_KEY_FILE)
            if (keyFile.exists()) {
                keyFile.delete()
                Log.d(TAG, "Removed encryption key from private storage")
            }

            // Remove from Android Keystore
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)

            if (keyStore.containsAlias(KEYSTORE_ALIAS)) {
                keyStore.deleteEntry(KEYSTORE_ALIAS)
                Log.d(TAG, "Removed encryption key from Android Keystore")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error clearing keys", e)
        }
    }

    private fun retrieveKeyInternalLogic(
        currentActivity: FragmentActivity,
        callback: KeystoreOperationCallback,
    ) {
        // Check if we have a stored key
        val keyFile = File(context.filesDir, ENCRYPTED_KEY_FILE)
        if (!keyFile.exists()) {
            Log.e(TAG, "No encryption key found")
            callback.onError(AppError.KeystoreKeyNotFound("No encryption key found in storage"))
            return
        }
        val encryptedKeyB64 = keyFile.readText()

        // Set up KeyStore
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)

        // Check if key exists
        if (!keyStore.containsAlias(KEYSTORE_ALIAS)) {
            Log.e(TAG, "Keystore key not found")
            callback.onError(AppError.KeystoreKeyNotFound("Keystore key not found in Android Keystore"))
            return
        }

        // Get the key
        val secretKey = keyStore.getKey(KEYSTORE_ALIAS, null) as SecretKey

        // Initialize cipher for decryption with IV from stored encrypted key
        val combined = Base64.decode(encryptedKeyB64, Base64.NO_WRAP)
        val byteBuffer = ByteBuffer.wrap(combined)
        val iv = ByteArray(12)
        byteBuffer.get(iv)

        val cipher = Cipher.getInstance(
            "${KeyProperties.KEY_ALGORITHM_AES}/" +
                "${KeyProperties.BLOCK_MODE_GCM}/" +
                KeyProperties.ENCRYPTION_PADDING_NONE,
        )
        val spec = GCMParameterSpec(128, iv)

        try {
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec)
        } catch (e: KeyPermanentlyInvalidatedException) {
            Log.w(TAG, "Key permanently invalidated, clearing keys", e)
            keyStore.deleteEntry(KEYSTORE_ALIAS)
            keyFile.delete()
            callback.onError(
                AppError.KeystoreKeyNotFound(
                    "Biometric enrollment changed. Please sign in with your password to re-enable biometric unlock.",
                    e,
                ),
            )
            return
        }

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(context.getString(R.string.biometric_unlock_vault_title))
            .setSubtitle(context.getString(R.string.biometric_unlock_vault_subtitle))
            .setNegativeButtonText(context.getString(R.string.common_cancel))
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()

        val biometricPrompt = BiometricPrompt(
            currentActivity,
            _executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(
                    result: BiometricPrompt.AuthenticationResult,
                ) {
                    try {
                        val authCipher = result.cryptoObject?.cipher ?: error("Cipher is null")
                        val combined = Base64.decode(encryptedKeyB64, Base64.NO_WRAP)
                        val byteBuffer = ByteBuffer.wrap(combined)
                        val iv = ByteArray(12)
                        byteBuffer.get(iv)
                        val encryptedBytes = ByteArray(byteBuffer.remaining())
                        byteBuffer.get(encryptedBytes)
                        val decryptedKey = authCipher.doFinal(encryptedBytes)

                        Log.d(TAG, "Encryption key retrieved successfully")
                        callback.onSuccess(String(decryptedKey))
                    } catch (e: Exception) {
                        Log.e(TAG, "Error retrieving encryption key", e)
                        callback.onError(
                            Exception("Failed to retrieve encryption key: ${e.message}"),
                        )
                    }
                }

                override fun onAuthenticationError(
                    errorCode: Int,
                    errString: CharSequence,
                ) {
                    Log.e(TAG, "Authentication error: $errorCode - $errString")
                    val error = when (errorCode) {
                        BiometricPrompt.ERROR_USER_CANCELED,
                        BiometricPrompt.ERROR_NEGATIVE_BUTTON,
                        BiometricPrompt.ERROR_CANCELED,
                        -> AppError.BiometricCancelled(
                            "Biometric authentication cancelled: $errString",
                        )
                        else -> AppError.BiometricFailed(
                            "Biometric authentication error: $errString (code: $errorCode)",
                        )
                    }
                    callback.onError(error)
                }

                override fun onAuthenticationFailed() {
                    Log.e(TAG, "Authentication failed")
                }
            },
        )

        biometricPrompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))
    }

    /**
     * Trigger standalone biometric authentication (no key retrieval).
     * Used for re-authentication before sensitive operations.
     * @param title The title to show in the biometric prompt
     * @param callback The callback to handle the result
     */
    override fun authenticateWithBiometric(title: String, callback: BiometricAuthCallback) {
        _mainHandler.post {
            try {
                val currentActivity = getCurrentActivity() as? FragmentActivity
                if (currentActivity == null) {
                    Log.e(TAG, "Current activity is not a FragmentActivity")
                    callback.onFailure()
                    return@post
                }

                // Set up KeyStore and get or create auth key
                val keyStore = KeyStore.getInstance("AndroidKeyStore")
                keyStore.load(null)

                // Use existing key if available, otherwise create one for auth purposes
                if (!keyStore.containsAlias(KEYSTORE_ALIAS)) {
                    Log.e(TAG, "No keystore key available for authentication")
                    callback.onFailure()
                    return@post
                }

                val secretKey = keyStore.getKey(KEYSTORE_ALIAS, null) as SecretKey

                // Initialize cipher for CryptoObject binding (encrypt mode with fresh IV)
                val cipher = Cipher.getInstance(
                    "${KeyProperties.KEY_ALGORITHM_AES}/" +
                        "${KeyProperties.BLOCK_MODE_GCM}/" +
                        KeyProperties.ENCRYPTION_PADDING_NONE,
                )

                try {
                    cipher.init(Cipher.ENCRYPT_MODE, secretKey)
                } catch (e: KeyPermanentlyInvalidatedException) {
                    Log.w(TAG, "Key permanently invalidated during auth", e)
                    keyStore.deleteEntry(KEYSTORE_ALIAS)
                    File(context.filesDir, ENCRYPTED_KEY_FILE).delete()
                    callback.onFailure()
                    return@post
                }

                val promptInfo = BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setNegativeButtonText(context.getString(R.string.common_cancel))
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .build()

                val biometricPrompt = BiometricPrompt(
                    currentActivity,
                    _executor,
                    object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(
                            result: BiometricPrompt.AuthenticationResult,
                        ) {
                            // Verify CryptoObject was used - this proves biometric auth occurred
                            val authCipher = result.cryptoObject?.cipher
                            if (authCipher == null) {
                                Log.e(TAG, "CryptoObject cipher is null after authentication")
                                _mainHandler.post {
                                    callback.onFailure()
                                }
                                return
                            }

                            _mainHandler.post {
                                callback.onSuccess()
                            }
                        }

                        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                            Log.e(TAG, "Biometric authentication error: $errString")
                            _mainHandler.post {
                                callback.onFailure()
                            }
                        }

                        override fun onAuthenticationFailed() {
                            // Don't call callback here, user can retry
                            Log.w(TAG, "Biometric authentication failed, user can retry")
                        }
                    },
                )

                // Authenticate with CryptoObject binding for cryptographic verification
                biometricPrompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))
            } catch (e: Exception) {
                Log.e(TAG, "Error in biometric authentication", e)
                callback.onFailure()
            }
        }
    }
}
