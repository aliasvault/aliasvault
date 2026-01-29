package net.aliasvault.app.vaultstore

import android.util.Log
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreProvider

/**
 * Handles cache management for the vault, including clearing cached data.
 */
class VaultCache(
    private val crypto: VaultCrypto,
    private val database: VaultDatabase,
    private val keystoreProvider: KeystoreProvider,
    private val storageProvider: net.aliasvault.app.vaultstore.storageprovider.StorageProvider,
) {
    companion object {
        private const val TAG = "VaultCache"
    }

    // region Cache Management

    /**
     * Clear the memory, removing the encryption key and decrypted database from memory.
     */
    fun clearCache() {
        Log.d(TAG, "Clearing cache - removing encryption key and decrypted database from memory")
        database.close()
        crypto.clearKey()
    }

    /**
     * Clear session data only (for forced logout).
     * Preserves vault data on disk for recovery on next login.
     * This is used when the user is forcibly logged out (e.g., 401, token revocation)
     * to allow recovery of unsynced local changes.
     */
    fun clearSession() {
        Log.d(TAG, "Clearing session - preserving vault data for recovery")

        // Clear in-memory data only
        clearCache()

        // Clear biometric-protected key (user will need to re-authenticate)
        keystoreProvider.clearKeys()
    }

    /**
     * Clear all vault data including from persisted storage.
     * This is used for user-initiated logout where they explicitly
     * choose to clear all local data.
     */
    fun clearVault() {
        clearCache()

        keystoreProvider.clearKeys()

        storageProvider.clearStorage()
    }

    // endregion
}
