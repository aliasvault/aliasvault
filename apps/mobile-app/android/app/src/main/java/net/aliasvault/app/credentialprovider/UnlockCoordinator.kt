package net.aliasvault.app.credentialprovider

import android.content.Intent
import android.util.Log
import androidx.fragment.app.FragmentActivity
import net.aliasvault.app.passwordunlock.PasswordUnlockActivity
import net.aliasvault.app.pinunlock.PinUnlockActivity
import net.aliasvault.app.vaultstore.AppError
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

        /**
         * Request code for password unlock activity result.
         * Activities using UnlockCoordinator should use this constant
         * when handling onActivityResult for password unlock.
         */
        const val REQUEST_CODE_PASSWORD_UNLOCK = 1002
    }

    /**
     * Start the unlock flow by checking which auth method is enabled.
     * Priority: Biometric -> PIN -> Password
     * Biometrics takes priority, PIN serves as fallback, and master password
     * is the final fallback (always available).
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
                // Neither PIN nor biometric is enabled - fall back to master password
                Log.d(TAG, "No biometric or PIN configured, falling back to password unlock")
                launchPasswordUnlock()
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
     * Launch password unlock activity.
     * Used as a final fallback when neither biometric nor PIN unlock is available
     * (or when both have failed).
     */
    fun launchPasswordUnlock() {
        val intent = Intent(activity, PasswordUnlockActivity::class.java)
        activity.startActivityForResult(intent, REQUEST_CODE_PASSWORD_UNLOCK)
    }

    /**
     * Attempt biometric unlock using the keystore provider.
     * Can be called directly to retry biometric unlock.
     */
    fun attemptBiometricUnlock() {
        val keystoreProvider = AndroidKeystoreProvider(activity.applicationContext)
        keystoreProvider.retrieveKeyExternal(
            activity,
            object : KeystoreOperationCallback {
                override fun onSuccess(result: String) {
                    try {
                        // Biometric authentication successful, unlock vault
                        vaultStore.storeEncryptionKeyInMemory(result)
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
     */
    fun handlePinUnlockResult(resultCode: Int, data: Intent?) {
        when (resultCode) {
            PinUnlockActivity.RESULT_SUCCESS -> {
                // PIN unlock successful - get encryption key and unlock vault
                val encryptionKey = data?.getStringExtra(PinUnlockActivity.EXTRA_ENCRYPTION_KEY)
                if (encryptionKey != null) {
                    try {
                        vaultStore.storeEncryptionKeyInMemory(encryptionKey)
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
                // PIN was disabled due to max attempts - fall back to biometric if available,
                // otherwise master password.
                Log.w(TAG, "PIN was disabled, attempting fallback")
                if (vaultStore.isBiometricAuthEnabled()) {
                    attemptBiometricUnlock()
                } else {
                    launchPasswordUnlock()
                }
            }
        }
    }

    /**
     * Handle result from password unlock activity.
     * Call this from the activity's onActivityResult method.
     */
    fun handlePasswordUnlockResult(resultCode: Int, data: Intent?) {
        when (resultCode) {
            PasswordUnlockActivity.RESULT_SUCCESS -> {
                val encryptionKey = data?.getStringExtra(PasswordUnlockActivity.EXTRA_ENCRYPTION_KEY)
                if (encryptionKey != null) {
                    try {
                        vaultStore.storeEncryptionKeyInMemory(encryptionKey)
                        vaultStore.unlockVault()
                        onUnlocked()
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to unlock vault after password unlock", e)
                        onError(getUnlockErrorMessage(e))
                    }
                } else {
                    Log.e(TAG, "No encryption key returned from password unlock")
                    onError("Failed to unlock vault")
                }
            }
            PasswordUnlockActivity.RESULT_MAX_ATTEMPTS_REACHED -> {
                // Vault has been cleared due to too many failed attempts.
                Log.w(TAG, "Password unlock failed: max attempts reached")
                onError("Too many failed unlock attempts")
            }
            PasswordUnlockActivity.RESULT_CANCELLED -> {
                Log.d(TAG, "Password unlock cancelled by user")
                onCancelled()
            }
            else -> {
                Log.e(TAG, "Unknown result from password unlock: $resultCode")
                onError("Failed to unlock vault")
            }
        }
    }

    /**
     * Handle errors during biometric unlock (after successful keystore retrieval).
     */
    private fun handleBiometricUnlockError(e: Exception) {
        val errorMessage = when (e) {
            is AppError.KeystoreKeyNotFound -> "Please unlock vault in the app first"
            is AppError.VaultDecryptFailed,
            is AppError.DatabaseOpenFailed,
            is AppError.DatabaseBackupFailed,
            -> "Failed to decrypt vault"
            else -> "Failed to unlock vault"
        }
        onError(errorMessage)
    }

    /**
     * Handle errors during biometric keystore retrieval, including the
     * user dismissing the prompt. Falls back to PIN if enabled, otherwise to
     * master password, mirroring the in-app and iOS autofill behavior so the
     * user always has another way to unlock if biometrics is unavailable
     * (e.g. fingerprint not recognized, or they tapped Cancel deliberately
     * because they want to use a different method).
     */
    private fun handleBiometricKeystoreError(e: Exception) {
        if (vaultStore.isPinEnabled()) {
            Log.d(TAG, "Biometric unavailable (${e.message}), falling back to PIN")
            launchPinUnlock()
            return
        }

        Log.d(TAG, "Biometric unavailable (${e.message}), falling back to password")
        launchPasswordUnlock()
    }

    /**
     * Get user-friendly error message for unlock errors.
     */
    private fun getUnlockErrorMessage(e: Exception): String {
        return when (e) {
            is AppError.KeystoreKeyNotFound -> "Please unlock vault in the app first"
            is AppError.VaultDecryptFailed,
            is AppError.DatabaseOpenFailed,
            is AppError.DatabaseBackupFailed,
            -> "Failed to decrypt vault"
            else -> "Failed to unlock vault"
        }
    }
}
