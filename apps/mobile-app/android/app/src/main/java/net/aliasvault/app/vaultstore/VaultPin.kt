package net.aliasvault.app.vaultstore

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import uniffi.aliasvault_core.pinDecrypt
import uniffi.aliasvault_core.pinEncrypt
import uniffi.aliasvault_core.pinGenerateSalt
import uniffi.aliasvault_core.pinIsLocked
import uniffi.aliasvault_core.pinRegisterFailure
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Exception types for PIN unlock operations.
 * UI layer should handle localization based on these exception types.
 */
sealed class PinUnlockException(message: String) : Exception(message) {
    /** PIN is locked after too many failed attempts. */
    object Locked : PinUnlockException("PIN locked after too many failed attempts")

    /**
     * Incorrect PIN with remaining attempts.
     * @property attemptsRemaining The number of attempts remaining before PIN is locked.
     */
    data class IncorrectPin(val attemptsRemaining: Int) : PinUnlockException("Incorrect PIN. $attemptsRemaining attempts remaining")

    /** Get error code for React Native bridge compatibility. */
    val errorCode: String
        get() = when (this) {
            is Locked -> "PIN_LOCKED"
            is IncorrectPin -> "INCORRECT_PIN"
        }
}

/**
 * Handles PIN unlock functionality for the vault store.
 * This component manages PIN-based unlocking by encrypting the Account Key
 * with a key derived from the user's PIN using Argon2id.
 * The key wrap and the attempt policy live in the Rust core (crypto/pin.rs); this class only stores them.
 * Other platform implementations: VaultStore+Pin.swift (iOS), PinUnlockService.ts (browser extension).
 *
 * Security features:
 * - 4 failed attempts maximum before requiring full password
 * - Salt stored in Android Keystore (makes offline brute-force impossible)
 * - Failed attempts counter stored in Keystore (prevents tampering)
 * - Encryption key derived using Argon2id (memory-hard, GPU-resistant)
 * - Encrypted data automatically deleted after max failed attempts
 *
 * @param context The Android context for accessing SharedPreferences and Keystore
 */
class VaultPin(
    context: Context,
) {
    private val sharedPreferences: SharedPreferences = context.getSharedPreferences("AliasVaultPrefs", Context.MODE_PRIVATE)
    private val keyStore: KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    companion object {
        /**
         * The tag for logging.
         */
        private const val TAG = "VaultPin"

        /**
         * Shared preferences keys for PIN metadata (non-sensitive data only).
         */
        private const val PIN_ENABLED_KEY = "aliasvault_pin_enabled"
        private const val PIN_LENGTH_KEY = "aliasvault_pin_length"

        /**
         * Android Keystore aliases for secure data storage.
         */
        private const val KEYSTORE_ALIAS_PIN_DATA = "aliasvault_pin_data"
        private const val KEYSTORE_ALIAS_FAILED_ATTEMPTS = "aliasvault_pin_failed_attempts"
        private const val KEYSTORE_ALIAS_DATA_ENCRYPTION = "aliasvault_pin_data_encryption_key"

        /**
         * AES-GCM parameters of the Keystore-encrypted storage.
         */
        private const val GCM_IV_LENGTH = 12
        private const val GCM_TAG_LENGTH = 128
    }

    // MARK: - PIN Status Methods

    /**
     * Check if PIN unlock is enabled.
     * @return True if PIN unlock is enabled, false otherwise
     */
    fun isPinEnabled(): Boolean {
        return sharedPreferences.getBoolean(PIN_ENABLED_KEY, false)
    }

    /**
     * Get the configured PIN length.
     * @return The PIN length, or null if PIN is not enabled
     */
    fun getPinLength(): Int? {
        if (!isPinEnabled()) return null
        val length = sharedPreferences.getInt(PIN_LENGTH_KEY, 0)
        return if (length > 0) length else null
    }

    /**
     * Get the failed attempts count from secure storage (Android Keystore).
     * @return The number of failed PIN attempts, or null when the counter is unreadable (which counts as locked)
     */
    private fun getPinFailedAttempts(): UInt? {
        return try {
            retrievePinFailedAttemptsFromKeystore()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to retrieve failed attempts, treating PIN as locked", e)
            null
        }
    }

    // MARK: - PIN Setup Methods

    /**
     * Setup PIN unlock.
     * Encrypts the Account Key with the PIN and stores it securely.
     *
     * @param pin The PIN to set (4+ digits)
     * @param accountKeyBase64 The base64-encoded Account Key to protect
     * @throws IllegalArgumentException if PIN format is invalid
     * @throws Exception if encryption or storage fails
     */
    @Throws(Exception::class)
    fun setupPin(pin: String, accountKeyBase64: String) {
        val accountKey = Base64.decode(accountKeyBase64, Base64.NO_WRAP)
        val salt = pinGenerateSalt()
        val encryptedKey = pinEncrypt(pin, salt, accountKey)

        // Store encrypted key and salt in Android Keystore
        storePinDataInKeystore(encryptedKey, salt)

        // Initialize failed attempts counter in Keystore
        storePinFailedAttemptsInKeystore(0)

        // Store PIN metadata in SharedPreferences (non-sensitive data only)
        sharedPreferences.edit().apply {
            putBoolean(PIN_ENABLED_KEY, true)
            putInt(PIN_LENGTH_KEY, pin.length)
            apply()
        }

        Log.d(TAG, "PIN unlock enabled successfully")
    }

    // MARK: - PIN Unlock Methods

    /**
     * Unlock with PIN.
     * Returns the decrypted Account Key.
     *
     * @param pin The PIN to use for unlocking
     * @return The decrypted key (base64)
     * @throws PinUnlockException with specific error type and metadata
     */
    @Throws(PinUnlockException::class)
    @Suppress("SwallowedException") // We intentionally swallow to avoid exposing crypto implementation details
    fun unlockWithPin(pin: String): String {
        val failedAttempts = getPinFailedAttempts()
        if (failedAttempts == null || pinIsLocked(failedAttempts)) {
            removeAndDisablePin()
            throw PinUnlockException.Locked
        }

        try {
            val (encryptedKey, salt) = retrievePinDataFromKeystore()
            val decryptedKey = pinDecrypt(pin, salt, encryptedKey)

            // Reset failed attempts on success
            storePinFailedAttemptsInKeystore(0)

            // Return the decrypted key as base64
            return Base64.encodeToString(decryptedKey, Base64.NO_WRAP)
        } catch (e: Exception) {
            val failure = pinRegisterFailure(failedAttempts)
            storePinFailedAttemptsInKeystore(failure.failedAttempts.toInt())

            // If max attempts reached, disable PIN and clear all stored data
            if (failure.locked) {
                removeAndDisablePin()
                throw PinUnlockException.Locked
            }

            throw PinUnlockException.IncorrectPin(failure.attemptsRemaining.toInt())
        }
    }

    /**
     * Reset failed attempts counter (called after successful password unlock).
     */
    fun resetPinFailedAttempts() {
        try {
            storePinFailedAttemptsInKeystore(0)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to reset PIN attempts", e)
        }
    }

    /**
     * Disable PIN unlock and remove all stored data.
     */
    fun removeAndDisablePin() {
        try {
            // Remove PIN data from Keystore
            removePinDataFromKeystore()

            // Remove failed attempts counter from Keystore
            removePinFailedAttemptsFromKeystore()

            // Clear PIN metadata from SharedPreferences
            sharedPreferences.edit().apply {
                remove(PIN_ENABLED_KEY)
                remove(PIN_LENGTH_KEY)
                apply()
            }

            Log.d(TAG, "PIN unlock disabled and all data removed")
        } catch (e: Exception) {
            Log.e(TAG, "Error removing PIN data", e)
            throw Exception("Failed to remove PIN data", e)
        }
    }

    // MARK: - Private PIN Methods

    // MARK: - PIN Data Storage (Encrypted Key + Salt)

    /**
     * Store PIN data (encrypted key and salt) in Android Keystore.
     */
    @Throws(Exception::class)
    private fun storePinDataInKeystore(encryptedKey: ByteArray, salt: ByteArray) {
        // Create JSON with both encrypted key and salt
        val pinData = JSONObject().apply {
            put("encryptedKey", Base64.encodeToString(encryptedKey, Base64.NO_WRAP))
            put("salt", Base64.encodeToString(salt, Base64.NO_WRAP))
        }
        val dataToStore = pinData.toString().toByteArray(Charsets.UTF_8)

        // Get or create encryption key for PIN data storage
        val secretKey = getOrCreateDataEncryptionKey()

        // Encrypt the PIN data
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        val encryptedData = cipher.doFinal(dataToStore)
        val iv = cipher.iv

        // Combine IV + encrypted data
        val combined = ByteArray(iv.size + encryptedData.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(encryptedData, 0, combined, iv.size, encryptedData.size)

        // Store in SharedPreferences
        val combinedBase64 = Base64.encodeToString(combined, Base64.NO_WRAP)
        sharedPreferences.edit().putString(KEYSTORE_ALIAS_PIN_DATA, combinedBase64).apply()
    }

    /**
     * Retrieve PIN data (encrypted key and salt) from Android Keystore.
     */
    @Throws(Exception::class)
    private fun retrievePinDataFromKeystore(): Pair<ByteArray, ByteArray> {
        // Get encrypted data from SharedPreferences
        val combinedBase64 = sharedPreferences.getString(KEYSTORE_ALIAS_PIN_DATA, null)
            ?: throw Exception("No PIN data found in keystore")

        val combined = Base64.decode(combinedBase64, Base64.NO_WRAP)
        val iv = combined.copyOfRange(0, GCM_IV_LENGTH)
        val encryptedData = combined.copyOfRange(GCM_IV_LENGTH, combined.size)

        // Get decryption key from Keystore
        val secretKey = keyStore.getKey(KEYSTORE_ALIAS_DATA_ENCRYPTION, null) as? SecretKey
            ?: throw Exception("Keystore key for PIN data not found")

        // Decrypt the PIN data
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH, iv))
        val decryptedData = cipher.doFinal(encryptedData)

        // Parse JSON
        val pinData = JSONObject(String(decryptedData, Charsets.UTF_8))
        val encryptedKey = Base64.decode(pinData.getString("encryptedKey"), Base64.NO_WRAP)
        val salt = Base64.decode(pinData.getString("salt"), Base64.NO_WRAP)

        return Pair(encryptedKey, salt)
    }

    /**
     * Remove PIN data from keystore.
     */
    @Throws(Exception::class)
    private fun removePinDataFromKeystore() {
        sharedPreferences.edit().remove(KEYSTORE_ALIAS_PIN_DATA).apply()
    }

    // MARK: - Failed Attempts Counter (Keystore Storage)

    /**
     * Store failed attempts counter in Android Keystore (not SharedPreferences).
     * This is stored in Keystore to prevent tampering.
     */
    @Throws(Exception::class)
    private fun storePinFailedAttemptsInKeystore(attempts: Int) {
        // Convert Int to ByteArray
        val attemptsData = ByteArray(4).apply {
            this[0] = (attempts shr 24).toByte()
            this[1] = (attempts shr 16).toByte()
            this[2] = (attempts shr 8).toByte()
            this[3] = attempts.toByte()
        }

        // Get or create encryption key for attempts storage
        val secretKey = getOrCreateDataEncryptionKey()

        // Encrypt the attempts data
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        val encryptedData = cipher.doFinal(attemptsData)
        val iv = cipher.iv

        // Combine IV + encrypted data
        val combined = ByteArray(iv.size + encryptedData.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(encryptedData, 0, combined, iv.size, encryptedData.size)

        // Store in SharedPreferences
        val combinedBase64 = Base64.encodeToString(combined, Base64.NO_WRAP)
        sharedPreferences.edit().putString(KEYSTORE_ALIAS_FAILED_ATTEMPTS, combinedBase64).apply()
    }

    /**
     * Retrieve failed attempts counter from Android Keystore.
     */
    @Throws(Exception::class)
    private fun retrievePinFailedAttemptsFromKeystore(): UInt {
        // Get encrypted data from SharedPreferences
        val combinedBase64 = sharedPreferences.getString(KEYSTORE_ALIAS_FAILED_ATTEMPTS, null)
            ?: return 0u // Default if not found

        val combined = Base64.decode(combinedBase64, Base64.NO_WRAP)
        val iv = combined.copyOfRange(0, GCM_IV_LENGTH)
        val encryptedData = combined.copyOfRange(GCM_IV_LENGTH, combined.size)

        // Get decryption key from Keystore
        val secretKey = keyStore.getKey(KEYSTORE_ALIAS_DATA_ENCRYPTION, null) as? SecretKey
            ?: throw Exception("Keystore key for PIN attempts not found")

        // Decrypt the attempts data
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH, iv))
        val decryptedData = cipher.doFinal(encryptedData)
        if (decryptedData.size != 4) {
            throw Exception("Invalid PIN failed attempts value")
        }

        // Convert ByteArray to Int
        val attempts = ((decryptedData[0].toInt() and 0xFF) shl 24) or
            ((decryptedData[1].toInt() and 0xFF) shl 16) or
            ((decryptedData[2].toInt() and 0xFF) shl 8) or
            (decryptedData[3].toInt() and 0xFF)
        return attempts.toUInt()
    }

    /**
     * Remove failed attempts counter from Android Keystore.
     */
    @Throws(Exception::class)
    private fun removePinFailedAttemptsFromKeystore() {
        sharedPreferences.edit().remove(KEYSTORE_ALIAS_FAILED_ATTEMPTS).apply()
    }

    // MARK: - Keystore Helper Methods

    /**
     * Get or create the encryption key for PIN data storage in Keystore.
     */
    @Throws(Exception::class)
    private fun getOrCreateDataEncryptionKey(): SecretKey {
        // Check if key already exists
        if (keyStore.containsAlias(KEYSTORE_ALIAS_DATA_ENCRYPTION)) {
            return keyStore.getKey(KEYSTORE_ALIAS_DATA_ENCRYPTION, null) as SecretKey
        }

        // Create new key
        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore",
        )

        val keySpec = KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS_DATA_ENCRYPTION,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(false)
            .setUnlockedDeviceRequired(true)
            .build()

        keyGenerator.init(keySpec)
        return keyGenerator.generateKey()
    }
}
