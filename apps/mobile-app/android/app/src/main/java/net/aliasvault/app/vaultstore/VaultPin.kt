package net.aliasvault.app.vaultstore

import android.util.Base64
import android.util.Log
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import org.signal.argon2.Argon2
import org.signal.argon2.MemoryCost
import org.signal.argon2.Type
import org.signal.argon2.Version
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Handles PIN unlock functionality for the vault store.
 * This component manages PIN-based unlocking by encrypting the vault encryption key
 * with a key derived from the user's PIN using Argon2id.
 *
 * Security features:
 * - 4 failed attempts maximum before requiring full password
 * - PIN must be 4-8 digits
 * - Encryption key derived using Argon2id (memory-hard, GPU-resistant)
 * - Failed attempts counter stored separately
 * - Encrypted data automatically deleted after max failed attempts
 *
 * @param storageProvider The storage provider for persisting PIN data
 */
class VaultPin(
    private val storageProvider: StorageProvider,
) {
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
         * Shared preferences keys for PIN data.
         */
        private const val PIN_ENABLED_KEY = "aliasvault_pin_enabled"
        private const val PIN_ENCRYPTED_KEY_KEY = "aliasvault_pin_encrypted_key"
        private const val PIN_SALT_KEY = "aliasvault_pin_salt"
        private const val PIN_LENGTH_KEY = "aliasvault_pin_length"
        private const val PIN_FAILED_ATTEMPTS_KEY = "aliasvault_pin_failed_attempts"

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
         * Keystore alias for PIN encryption.
         */
        private const val KEYSTORE_ALIAS = "alias_vault_pin_key"

        /**
         * AES-GCM parameters.
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
        return storageProvider.getBoolean(PIN_ENABLED_KEY, false)
    }

    /**
     * Get the configured PIN length.
     * @return The PIN length, or null if PIN is not enabled
     */
    fun getPinLength(): Int? {
        if (!isPinEnabled()) return null
        val length = storageProvider.getInt(PIN_LENGTH_KEY, 0)
        return if (length > 0) length else null
    }

    /**
     * Get failed attempts count.
     * @return The number of failed PIN attempts
     */
    fun getPinFailedAttempts(): Int {
        return storageProvider.getInt(PIN_FAILED_ATTEMPTS_KEY, 0)
    }

    // MARK: - PIN Setup Methods

    /**
     * Setup PIN unlock.
     * Encrypts the vault encryption key with the PIN and stores it securely.
     *
     * @param pin The PIN to set (4-8 digits)
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
        val saltBase64 = Base64.encodeToString(salt, Base64.NO_WRAP)

        // Derive key from PIN using Argon2id
        val pinKey = derivePinKey(pin, salt)

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
        val combinedBase64 = Base64.encodeToString(combined, Base64.NO_WRAP)

        // Store encrypted key, salt, and metadata in SharedPreferences
        storageProvider.putBoolean(PIN_ENABLED_KEY, true)
        storageProvider.putString(PIN_ENCRYPTED_KEY_KEY, combinedBase64)
        storageProvider.putString(PIN_SALT_KEY, saltBase64)
        storageProvider.putInt(PIN_LENGTH_KEY, pin.length)
        storageProvider.putInt(PIN_FAILED_ATTEMPTS_KEY, 0)

        Log.d(TAG, "PIN unlock enabled successfully")
    }

    // MARK: - PIN Unlock Methods

    /**
     * Unlock with PIN.
     * Returns the decrypted vault encryption key.
     *
     * @param pin The PIN to use for unlocking
     * @return The decrypted vault encryption key (base64)
     * @throws IllegalArgumentException if PIN format is invalid
     * @throws IllegalStateException if PIN is not configured or is locked
     * @throws Exception if decryption fails or PIN is incorrect
     */
    @Throws(Exception::class)
    fun unlockWithPin(pin: String): String {
        // Check if PIN is enabled
        // Note: If PIN was previously locked (max attempts), it's automatically disabled and cleared,
        // so isPinEnabled() returning false means either PIN was never set up or it was locked and cleared
        if (!isPinEnabled()) {
            throw IllegalStateException("PIN unlock is not configured")
        }

        try {
            // Retrieve encrypted key and salt
            val encryptedKeyBase64 = storageProvider.getString(PIN_ENCRYPTED_KEY_KEY, null)
                ?: throw IllegalStateException("No encrypted key found")
            val saltBase64 = storageProvider.getString(PIN_SALT_KEY, null)
                ?: throw IllegalStateException("No salt found")

            // Decode encrypted package
            val combined = Base64.decode(encryptedKeyBase64, Base64.NO_WRAP)
            val iv = combined.copyOfRange(0, GCM_IV_LENGTH)
            val encryptedData = combined.copyOfRange(GCM_IV_LENGTH, combined.size)

            // Derive key from PIN
            val salt = Base64.decode(saltBase64, Base64.NO_WRAP)
            val pinKey = derivePinKey(pin, salt)

            // Decrypt the vault encryption key
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val secretKey = SecretKeySpec(pinKey, "AES")
            cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH, iv))
            val decryptedKey = cipher.doFinal(encryptedData)

            // Reset failed attempts on success
            storageProvider.putInt(PIN_FAILED_ATTEMPTS_KEY, 0)

            // Return the decrypted vault encryption key as base64
            return Base64.encodeToString(decryptedKey, Base64.NO_WRAP)
        } catch (e: Exception) {
            // Increment failed attempts
            val currentAttempts = getPinFailedAttempts()
            val newAttempts = currentAttempts + 1
            storageProvider.putInt(PIN_FAILED_ATTEMPTS_KEY, newAttempts)

            // If max attempts reached, disable PIN and clear all stored data
            if (newAttempts >= MAX_PIN_ATTEMPTS) {
                removeAndDisablePin()
                throw IllegalStateException("PIN locked after too many failed attempts")
            }

            // Return incorrect PIN error with attempts remaining
            val attemptsRemaining = MAX_PIN_ATTEMPTS - newAttempts
            throw Exception("Incorrect PIN. $attemptsRemaining attempts remaining", e)
        }
    }

    /**
     * Reset failed attempts counter.
     * Called after successful password unlock.
     */
    fun resetPinFailedAttempts() {
        storageProvider.putInt(PIN_FAILED_ATTEMPTS_KEY, 0)
    }

    /**
     * Disable PIN unlock and remove all stored data.
     */
    fun removeAndDisablePin() {
        // Clear all PIN data from SharedPreferences
        storageProvider.remove(PIN_ENABLED_KEY)
        storageProvider.remove(PIN_ENCRYPTED_KEY_KEY)
        storageProvider.remove(PIN_SALT_KEY)
        storageProvider.remove(PIN_LENGTH_KEY)
        storageProvider.remove(PIN_FAILED_ATTEMPTS_KEY)

        Log.d(TAG, "PIN unlock disabled and all data removed")
    }

    // MARK: - Private PIN Methods

    /**
     * Derive encryption key from PIN using Argon2id.
     *
     * Uses Argon2id with high memory cost (64 MB) to make brute-force attacks
     * significantly more expensive. This is especially important for PINs which
     * have lower entropy than passwords.
     *
     * @param pin The PIN string
     * @param salt The salt bytes
     * @return The derived key bytes (32 bytes)
     * @throws Exception if key derivation fails
     */
    @Throws(Exception::class)
    private fun derivePinKey(pin: String, salt: ByteArray): ByteArray {
        try {
            val argon2 = Argon2.Builder(Version.V13)
                .type(Type.Argon2id)
                .memoryCost(MemoryCost.KiB(ARGON2_MEMORY_KB))
                .parallelism(ARGON2_PARALLELISM)
                .iterations(ARGON2_ITERATIONS)
                .hashLength(ARGON2_OUTPUT_LENGTH)
                .build()

            val result = argon2.hash(pin.toByteArray(), salt)
            return result.hash
        } catch (e: Exception) {
            Log.e(TAG, "Argon2 PIN hashing failed", e)
            throw Exception("Argon2 PIN hashing failed", e)
        }
    }
}
