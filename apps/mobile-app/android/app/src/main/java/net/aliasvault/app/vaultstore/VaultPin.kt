package net.aliasvault.app.vaultstore

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import com.lambdapioneer.argon2kt.Argon2Kt
import com.lambdapioneer.argon2kt.Argon2Mode
import com.lambdapioneer.argon2kt.Argon2Version
import org.json.JSONObject
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Exception types for PIN unlock operations.
 * UI layer should handle localization based on these exception types.
 */
sealed class PinUnlockException(message: String) : Exception(message) {
    /** PIN is not configured. */
    object NotConfigured : PinUnlockException("PIN unlock is not configured")

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
            is NotConfigured -> "PIN_NOT_CONFIGURED"
            is Locked -> "PIN_LOCKED"
            is IncorrectPin -> "INCORRECT_PIN"
        }
}

/**
 * Handles PIN unlock functionality for the vault store.
 * This component manages PIN-based unlocking by encrypting the vault encryption key
 * with a key derived from the user's PIN using Argon2id.
 *
 * Security features:
 * - 4 failed attempts maximum before requiring full password
 * - Device pepper stored in Android Keystore (makes offline brute-force impossible)
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
         * The maximum number of failed PIN attempts before locking.
         */
        private const val MAX_PIN_ATTEMPTS = 4

        /**
         * Shared preferences keys for PIN metadata (non-sensitive data only).
         */
        private const val PIN_ENABLED_KEY = "aliasvault_pin_enabled"
        private const val PIN_LENGTH_KEY = "aliasvault_pin_length"

        /**
         * Android Keystore aliases for secure data storage.
         */
        private const val KEYSTORE_ALIAS_PIN_DATA = "aliasvault_pin_data"
        private const val KEYSTORE_ALIAS_PIN_PEPPER = "aliasvault_pin_pepper"
        private const val KEYSTORE_ALIAS_FAILED_ATTEMPTS = "aliasvault_pin_failed_attempts"
        private const val KEYSTORE_ALIAS_DATA_ENCRYPTION = "aliasvault_pin_data_encryption_key"

        /**
         * Argon2id parameters for PIN key derivation.
         * These parameters are chosen for security against brute-force attacks:
         * - Memory: 65536 KB (64 MB) - makes GPU attacks much harder
         * - Iterations: 3 - standard for Argon2id
         * - Parallelism: 1 - suitable for mobile environment
         * - Output: 32 bytes for AES-256-GCM
         */
        private const val ARGON2_ITERATIONS = 3
        private const val ARGON2_MEMORY_KB = 65536 // 64 MB
        private const val ARGON2_PARALLELISM = 1
        private const val ARGON2_OUTPUT_LENGTH = 32

        /**
         * AES-GCM parameters.
         */
        private const val GCM_IV_LENGTH = 12
        private const val GCM_TAG_LENGTH = 128

        /**
         * Device pepper size (32 bytes for strong security).
         */
        private const val PEPPER_SIZE = 32
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
     * Get failed attempts count from secure storage (Android Keystore).
     * @return The number of failed PIN attempts
     */
    fun getPinFailedAttempts(): Int {
        return try {
            retrievePinFailedAttemptsFromKeystore()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to retrieve failed attempts, returning 0", e)
            0
        }
    }

    // MARK: - PIN Setup Methods

    /**
     * Setup PIN unlock.
     * Encrypts the vault encryption key with the PIN and stores it securely.
     *
     * @param pin The PIN to set (4+ digits)
     * @param vaultEncryptionKeyBase64 The base64-encoded vault encryption key to protect
     * @throws IllegalArgumentException if PIN format is invalid
     * @throws Exception if encryption or storage fails
     */
    @Throws(Exception::class)
    fun setupPin(pin: String, vaultEncryptionKeyBase64: String) {
        // Decode the vault encryption key
        val vaultEncryptionKey = Base64.decode(vaultEncryptionKeyBase64, Base64.NO_WRAP)

        // Generate random salt
        val salt = ByteArray(16)
        SecureRandom().nextBytes(salt)

        // Generate or retrieve device pepper (device-bound secret)
        val pepper = getOrCreateDevicePepper()

        // Derive key from PIN + pepper using Argon2id
        val pinKey = derivePinKey(pin, salt, pepper)

        // Encrypt the vault encryption key using AES-GCM
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val secretKey = SecretKeySpec(pinKey, "AES")

        // Generate random IV for AES-GCM
        val iv = ByteArray(GCM_IV_LENGTH)
        SecureRandom().nextBytes(iv)

        cipher.init(Cipher.ENCRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH, iv))
        val encryptedKey = cipher.doFinal(vaultEncryptionKey)

        // Combine IV + encrypted data
        val combined = ByteArray(iv.size + encryptedKey.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(encryptedKey, 0, combined, iv.size, encryptedKey.size)

        // Store encrypted key and salt in Android Keystore
        storePinDataInKeystore(combined, salt)

        // Initialize failed attempts counter in Keystore
        storePinFailedAttemptsInKeystore(0)

        // Store PIN metadata in SharedPreferences (non-sensitive data only)
        sharedPreferences.edit().apply {
            putBoolean(PIN_ENABLED_KEY, true)
            putInt(PIN_LENGTH_KEY, pin.length)
            apply()
        }

        Log.d(TAG, "PIN unlock enabled successfully with device pepper")
    }

    // MARK: - PIN Unlock Methods

    /**
     * Unlock with PIN.
     * Returns the decrypted vault encryption key.
     *
     * @param pin The PIN to use for unlocking
     * @return The decrypted vault encryption key (base64)
     * @throws PinUnlockException with specific error type and metadata
     */
    @Throws(PinUnlockException::class)
    @Suppress("SwallowedException") // We intentionally swallow to avoid exposing crypto implementation details
    fun unlockWithPin(pin: String): String {
        // Check if PIN is enabled
        if (!isPinEnabled()) {
            throw PinUnlockException.NotConfigured
        }

        try {
            // Retrieve encrypted key, salt, and pepper from Keystore
            val (encryptedKey, salt) = retrievePinDataFromKeystore()
            val pepper = retrieveDevicePepper()

            // Decode encrypted package
            val iv = encryptedKey.copyOfRange(0, GCM_IV_LENGTH)
            val encryptedData = encryptedKey.copyOfRange(GCM_IV_LENGTH, encryptedKey.size)

            // Derive key from PIN + pepper
            val pinKey = derivePinKey(pin, salt, pepper)

            // Decrypt the vault encryption key
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val secretKey = SecretKeySpec(pinKey, "AES")
            cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH, iv))
            val decryptedKey = cipher.doFinal(encryptedData)

            // Reset failed attempts on success
            storePinFailedAttemptsInKeystore(0)

            // Return the decrypted vault encryption key as base64
            return Base64.encodeToString(decryptedKey, Base64.NO_WRAP)
        } catch (e: Exception) {
            // Increment failed attempts
            val currentAttempts = getPinFailedAttempts()
            val newAttempts = currentAttempts + 1
            storePinFailedAttemptsInKeystore(newAttempts)

            // If max attempts reached, disable PIN and clear all stored data
            if (newAttempts >= MAX_PIN_ATTEMPTS) {
                removeAndDisablePin()
                throw PinUnlockException.Locked
            }

            // Return incorrect PIN error with attempts remaining
            val attemptsRemaining = MAX_PIN_ATTEMPTS - newAttempts
            throw PinUnlockException.IncorrectPin(attemptsRemaining)
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

            // Note: We DO NOT remove the device pepper - it's reused if PIN is re-enabled
            // This maintains consistency and doesn't degrade security

            // Clear PIN metadata from SharedPreferences
            sharedPreferences.edit().apply {
                remove(PIN_ENABLED_KEY)
                remove(PIN_LENGTH_KEY)
                apply()
            }

            Log.d(TAG, "PIN unlock disabled and all data removed (pepper retained)")
        } catch (e: Exception) {
            Log.e(TAG, "Error removing PIN data", e)
            throw Exception("Failed to remove PIN data", e)
        }
    }

    // MARK: - Private PIN Methods

    /**
     * Derive encryption key from PIN + pepper using Argon2id.
     *
     * Uses Argon2id with high memory cost (64 MB) and a device-bound pepper
     * to make offline brute-force attacks infeasible even if the encrypted blob is exfiltrated.
     *
     * The pepper is a 32-byte random value stored in Android Keystore,
     * which means an attacker who steals the encrypted blob cannot brute-force offline
     * because they don't have the pepper.
     *
     * @param pin User's PIN (low entropy)
     * @param salt Random salt (stored with encrypted data)
     * @param pepper Device-bound secret (stored in Keystore, not with encrypted data)
     * @return The derived key bytes (32 bytes)
     * @throws Exception if key derivation fails
     */
    @Throws(Exception::class)
    private fun derivePinKey(pin: String, salt: ByteArray, pepper: ByteArray): ByteArray {
        try {
            // Concatenate PIN + pepper before hashing
            // This ensures offline brute-force is impossible without the pepper
            val pinBytes = pin.toByteArray(Charsets.UTF_8)
            val combinedInput = ByteArray(pinBytes.size + pepper.size)
            System.arraycopy(pinBytes, 0, combinedInput, 0, pinBytes.size)
            System.arraycopy(pepper, 0, combinedInput, pinBytes.size, pepper.size)

            val argon2 = Argon2Kt()

            val hashResult = argon2.hash(
                mode = Argon2Mode.ARGON2_ID,
                password = combinedInput,
                salt = salt,
                tCostInIterations = ARGON2_ITERATIONS,
                mCostInKibibyte = ARGON2_MEMORY_KB,
                parallelism = ARGON2_PARALLELISM,
                hashLengthInBytes = ARGON2_OUTPUT_LENGTH,
                version = Argon2Version.V13,
            )

            return hashResult.rawHashAsByteArray()
        } catch (e: Exception) {
            Log.e(TAG, "Argon2 PIN hashing failed", e)
            throw Exception("Argon2 PIN hashing failed", e)
        }
    }

    // MARK: - Device Pepper Management

    /**
     * Get or create device pepper (device-bound secret).
     *
     * The pepper is a 32-byte random value stored in Android Keystore.
     * It's only readable when the device is unlocked (device credential required).
     * This makes offline brute-force impossible because the pepper isn't in the encrypted blob.
     */
    @Throws(Exception::class)
    private fun getOrCreateDevicePepper(): ByteArray {
        // Try to retrieve existing pepper
        return try {
            retrieveDevicePepper()
        } catch (e: Exception) {
            // Pepper doesn't exist, generate new 32-byte pepper
            Log.d(TAG, "Device pepper not found, creating new one", e)
            val pepper = ByteArray(PEPPER_SIZE)
            SecureRandom().nextBytes(pepper)

            // Store pepper in Android Keystore with strong device protection
            storePepperInKeystore(pepper)

            Log.d(TAG, "Device pepper created and stored securely")
            pepper
        }
    }

    /**
     * Store pepper in Android Keystore with device-bound protection.
     */
    @Throws(Exception::class)
    private fun storePepperInKeystore(pepper: ByteArray) {
        // Create encryption key for pepper storage in Keystore
        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore",
        )

        val keySpec = KeyGenParameterSpec.Builder(
            KEYSTORE_ALIAS_PIN_PEPPER,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(false)
            // Require device to be unlocked (equivalent to iOS's kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly)
            .setUnlockedDeviceRequired(true)
            .build()

        keyGenerator.init(keySpec)
        val secretKey = keyGenerator.generateKey()

        // Encrypt pepper
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        val encryptedPepper = cipher.doFinal(pepper)
        val iv = cipher.iv

        // Combine IV + encrypted pepper
        val combined = ByteArray(iv.size + encryptedPepper.size)
        System.arraycopy(iv, 0, combined, 0, iv.size)
        System.arraycopy(encryptedPepper, 0, combined, iv.size, encryptedPepper.size)

        // Store in SharedPreferences (encrypted by Keystore key)
        val pepperBase64 = Base64.encodeToString(combined, Base64.NO_WRAP)
        sharedPreferences.edit().putString(KEYSTORE_ALIAS_PIN_PEPPER, pepperBase64).apply()
    }

    /**
     * Retrieve pepper from Android Keystore.
     */
    @Throws(Exception::class)
    private fun retrieveDevicePepper(): ByteArray {
        // Get encrypted pepper from SharedPreferences
        val pepperBase64 = sharedPreferences.getString(KEYSTORE_ALIAS_PIN_PEPPER, null)
            ?: throw Exception("Device pepper not found")

        val combined = Base64.decode(pepperBase64, Base64.NO_WRAP)
        val iv = combined.copyOfRange(0, GCM_IV_LENGTH)
        val encryptedPepper = combined.copyOfRange(GCM_IV_LENGTH, combined.size)

        // Get decryption key from Keystore
        val secretKey = keyStore.getKey(KEYSTORE_ALIAS_PIN_PEPPER, null) as? SecretKey
            ?: throw Exception("Keystore key for pepper not found")

        // Decrypt pepper
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH, iv))
        return cipher.doFinal(encryptedPepper)
    }

    // MARK: - PIN Data Storage (Encrypted Key + Salt)

    /**
     * Store PIN data (encrypted key and salt) in Android Keystore.
     * Note: We DO NOT store the pepper here - it's separate for security.
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
    private fun retrievePinFailedAttemptsFromKeystore(): Int {
        // Get encrypted data from SharedPreferences
        val combinedBase64 = sharedPreferences.getString(KEYSTORE_ALIAS_FAILED_ATTEMPTS, null)
            ?: return 0 // Default if not found

        try {
            val combined = Base64.decode(combinedBase64, Base64.NO_WRAP)
            val iv = combined.copyOfRange(0, GCM_IV_LENGTH)
            val encryptedData = combined.copyOfRange(GCM_IV_LENGTH, combined.size)

            // Get decryption key from Keystore
            val secretKey = keyStore.getKey(KEYSTORE_ALIAS_DATA_ENCRYPTION, null) as? SecretKey
                ?: return 0

            // Decrypt the attempts data
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH, iv))
            val decryptedData = cipher.doFinal(encryptedData)

            // Convert ByteArray to Int
            return ((decryptedData[0].toInt() and 0xFF) shl 24) or
                ((decryptedData[1].toInt() and 0xFF) shl 16) or
                ((decryptedData[2].toInt() and 0xFF) shl 8) or
                (decryptedData[3].toInt() and 0xFF)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode failed attempts", e)
            return 0
        }
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
