package net.aliasvault.app.vaultstore

import android.util.Log
import net.aliasvault.app.vaultstore.storageprovider.StorageProvider
import java.util.Timer
import java.util.TimerTask

/**
 * Handles authentication methods and auto-lock functionality for the vault.
 */
class VaultAuth(
    private val storageProvider: StorageProvider,
    private val onClearCache: () -> Unit,
) {
    companion object {
        private const val TAG = "VaultAuth"
    }

    private var clearCacheTimer: Timer? = null
    private var backgroundTimestamp: Long? = null

    // region Authentication Methods

    /**
     * Set the auth methods.
     */
    fun setAuthMethods(authMethods: String) {
        storageProvider.setAuthMethods(authMethods)
    }

    /**
     * Get the auth methods.
     */
    fun getAuthMethods(): String {
        return storageProvider.getAuthMethods()
    }

    // endregion

    // region Auto-Lock Timeout

    /**
     * Set the auto-lock timeout.
     */
    fun setAutoLockTimeout(timeout: Int) {
        storageProvider.setAutoLockTimeout(timeout)
    }

    /**
     * Get the auto-lock timeout.
     */
    fun getAutoLockTimeout(): Int {
        return storageProvider.getAutoLockTimeout()
    }

    // endregion

    // region Background/Foreground Handling

    /**
     * Called when the app process enters the background (all activities are stopped).
     * Starts a timer that will clear decrypted vault from memory after the configured auto-lock timeout.
     */
    fun onAppBackgrounded() {
        val timeout = getAutoLockTimeout()
        Log.d(TAG, "App entered background, starting auto-lock timer with ${timeout}s")

        // Cancel any existing timer
        clearCacheTimer?.cancel()
        clearCacheTimer = null

        // Record when we backgrounded
        backgroundTimestamp = System.currentTimeMillis()

        if (timeout > 0) {
            clearCacheTimer = Timer("VaultAutoLock", true).apply {
                schedule(
                    object : TimerTask() {
                        override fun run() {
                            Log.d(TAG, "Auto-lock timer fired, clearing cache")
                            onClearCache()
                        }
                    },
                    timeout.toLong() * 1000,
                )
            }
        }
    }

    /**
     * Called when the app process enters the foreground (at least one activity is visible).
     * Cancels the auto-lock timer if it hasn't fired yet, or clears the memory if the timeout
     * has already elapsed while the app was backgrounded.
     */
    fun onAppForegrounded() {
        Log.d(TAG, "App will enter foreground, checking auto-lock timer")

        val timeout = getAutoLockTimeout()
        val bgTime = backgroundTimestamp

        // Check if timer has already elapsed while we were in background
        if (timeout > 0 && bgTime != null) {
            val elapsedSeconds = (System.currentTimeMillis() - bgTime) / 1000
            if (elapsedSeconds >= timeout) {
                Log.d(TAG, "Timer elapsed ($elapsedSeconds seconds >= $timeout seconds), clearing cache now")
                onClearCache()
            }
        }

        // Cancel and clear the timer
        clearCacheTimer?.cancel()
        clearCacheTimer = null
        backgroundTimestamp = null

        Log.d(TAG, "Auto-lock timer canceled")
    }

    /**
     * Clean up resources when VaultAuth is destroyed.
     */
    fun cleanup() {
        clearCacheTimer?.cancel()
        clearCacheTimer = null
        backgroundTimestamp = null
    }

    // endregion
}
