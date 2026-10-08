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
     * Clear all vault data including from persisted storage.
     * This is used for user-initiated logout where they explicitly
     * choose to clear all local data.
     */
    fun clearVault() {
        clearCache()

        keystoreProvider.clearKeys()

        storageProvider.clearStorage()
        storageProvider.clearSyncEngineState()
    }

    // endregion
}
