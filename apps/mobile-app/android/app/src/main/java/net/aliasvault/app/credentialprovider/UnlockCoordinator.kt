package net.aliasvault.app.credentialprovider

import android.content.Intent
import android.util.Log
import androidx.fragment.app.FragmentActivity
import net.aliasvault.app.R
import net.aliasvault.app.pinunlock.PinUnlockActivity
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreOperationCallback

/**
 * UnlockCoordinator
 *
 * Centralized coordinator for handling vault unlock flow in credential provider activities.
 * This coordinator manages the unlock sequence, deciding whether to use PIN or biometric
 * authentication based on what's enabled.
 *
 * Similar to iOS UnlockCoordinator.swift - provides a clean separation of unlock logic
 * from the main activity flows.
 */
class UnlockCoordinator(
    private val activity: FragmentActivity,
    private val vaultStore: VaultStore,
    private val onUnlocked: () -> Unit,
    private val onCancelled: () -> Unit,
    private val onError: (String) -> Unit,
) {
    companion object {
        private const val TAG = "UnlockCoordinator"

        /**
         * Request code for PIN unlock activity result.
         * Activities using UnlockCoordinator should use this constant
         * when handling onActivityResult for PIN unlock.
         */
        const val REQUEST_CODE_PIN_UNLOCK = 1001
    }

    /**
     * Start the unlock flow by checking which auth method is enabled.
     * Priority: Biometric -> PIN -> Error
     * Biometrics takes priority, PIN serves as fallback if biometrics fails or is unavailable.
     */
    fun startUnlockFlow() {
        val pinEnabled = vaultStore.isPinEnabled()
        val biometricEnabled = vaultStore.isBiometricAuthEnabled()

        when {
            biometricEnabled -> {
                // Biometric is enabled - attempt biometric unlock first
                Log.d(TAG, "Biometric unlock is enabled, attempting biometric unlock")
                attemptBiometricUnlock()
            }
            pinEnabled -> {
                // Only PIN is enabled - launch PIN unlock activity
                Log.d(TAG, "PIN unlock is enabled, launching PIN unlock activity")
                launchPinUnlock()
            }
            else -> {
                // Neither PIN nor biometric is enabled
                Log.e(TAG, "No unlock method is enabled or available")
                onError(activity.getString(R.string.error_unlock_method_required))
            }
        }
    }

    /**
     * Launch PIN unlock activity.
     * Can be called directly to retry PIN unlock.
     */
    fun launchPinUnlock() {
        val intent = Intent(activity, PinUnlockActivity::class.java)
        activity.startActivityForResult(intent, REQUEST_CODE_PIN_UNLOCK)
    }

    /**
     * Attempt biometric unlock using the keystore provider.
     * Can be called directly to retry biometric unlock.
     */
    fun attemptBiometricUnlock() {
        val keystoreProvider = AndroidKeystoreProvider(activity.applicationContext) { activity }
        keystoreProvider.retrieveKeyExternal(
            activity,
            object : KeystoreOperationCallback {
                override fun onSuccess(result: String) {
                    try {
                        // Biometric authentication successful, unlock vault
                        vaultStore.initEncryptionKey(result)
                        vaultStore.unlockVault()

                        // Notify success
                        activity.runOnUiThread {
                            onUnlocked()
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to unlock vault after biometric auth", e)
                        activity.runOnUiThread {
                            handleBiometricUnlockError(e)
                        }
                    }
                }

                override fun onError(e: Exception) {
                    Log.e(TAG, "Failed to retrieve encryption key", e)
                    activity.runOnUiThread {
                        handleBiometricKeystoreError(e)
                    }
                }
            },
        )
    }

    /**
     * Handle result from PIN unlock activity.
     * Call this from the activity's onActivityResult method.
     */
    fun handlePinUnlockResult(resultCode: Int, data: Intent?) {
        when (resultCode) {
            PinUnlockActivity.RESULT_SUCCESS -> {
                // PIN unlock successful - get encryption key and unlock vault
                val encryptionKey = data?.getStringExtra(PinUnlockActivity.EXTRA_ENCRYPTION_KEY)
                if (encryptionKey != null) {
                    try {
                        vaultStore.initEncryptionKey(encryptionKey)
                        vaultStore.unlockVault()
                        onUnlocked()
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to unlock vault after PIN unlock", e)
                        onError(getUnlockErrorMessage(e))
                    }
                } else {
                    Log.e(TAG, "No encryption key returned from PIN unlock")
                    onError("Failed to unlock vault")
                }
            }
            PinUnlockActivity.RESULT_CANCELLED -> {
                // User cancelled PIN unlock
                Log.d(TAG, "PIN unlock cancelled by user")
                onCancelled()
            }
            PinUnlockActivity.RESULT_PIN_DISABLED -> {
                // PIN was disabled due to max attempts - fall back to biometric if available
                Log.w(TAG, "PIN was disabled, attempting biometric unlock fallback")
                if (vaultStore.isBiometricAuthEnabled()) {
                    attemptBiometricUnlock()
                } else {
                    onError(activity.getString(R.string.error_unlock_method_required))
                }
            }
        }
    }

    /**
     * Handle errors during biometric unlock (after successful keystore retrieval).
     */
    private fun handleBiometricUnlockError(e: Exception) {
        val errorMessage = when {
            e.message?.contains("No encryption key found", ignoreCase = true) == true ->
                "Please unlock vault in the app first"
            e.message?.contains("Database setup error", ignoreCase = true) == true ->
                "Failed to decrypt vault"
            else -> "Failed to unlock vault"
        }
        onError(errorMessage)
    }

    /**
     * Handle errors during biometric keystore retrieval.
     * Falls back to PIN if enabled, otherwise reports the error.
     */
    private fun handleBiometricKeystoreError(e: Exception) {
        // For any biometric error, try PIN fallback if enabled
        if (vaultStore.isPinEnabled()) {
            Log.d(TAG, "Biometric failed (${e.message}), falling back to PIN")
            launchPinUnlock()
            return // Don't call onError, we're falling back to PIN
        }

        // No PIN fallback available - report the error
        val errorMessage = when {
            e.message?.contains("user canceled", ignoreCase = true) == true ||
                e.message?.contains("canceled", ignoreCase = true) == true ->
                "Authentication cancelled"
            else -> "Failed to retrieve encryption key"
        }
        onError(errorMessage)
    }

    /**
     * Get user-friendly error message for unlock errors.
     */
    private fun getUnlockErrorMessage(e: Exception): String {
        return when {
            e.message?.contains("No encryption key found", ignoreCase = true) == true ->
                "Please unlock vault in the app first"
            e.message?.contains("Database setup error", ignoreCase = true) == true ->
                "Failed to decrypt vault"
            else -> "Failed to unlock vault"
        }
    }
}
