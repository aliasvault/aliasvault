package net.aliasvault.app.vaultstore.keystoreprovider

import androidx.fragment.app.FragmentActivity

/**
 * Interface for keystore providers that handle secure storage of encryption keys with biometric protection.
 * This allows for different implementations for real devices and testing.
 */
interface KeystoreProvider {
    /**
     * Check if biometric authentication is available on the device.
     * @return true if biometric authentication is available, false otherwise
     */
    fun isBiometricAvailable(): Boolean

    /**
     * Store an encryption key with biometric protection.
     * @param activity The activity to show the biometric prompt on
     * @param key The encryption key to store
     * @param callback The callback to handle the result
     */
    fun storeKey(key: String, callback: KeystoreOperationCallback)

    /**
     * Retrieve an encryption key using biometric authentication.
     * @param activity The activity to show the biometric prompt on
     * @param callback The callback to handle the result
     */
    fun retrieveKey(callback: KeystoreOperationCallback)

    /**
     * Retrieve an encryption key using biometric authentication from outside of React Native context.
     * This is used by the passkey flows.
     * @param activity The activity to show the biometric prompt on
     * @param callback The callback to handle the result asynchronously
     */
    fun retrieveKeyExternal(activity: FragmentActivity, callback: KeystoreOperationCallback)

    /**
     * Clear all stored keys.
     */
    fun clearKeys()

    /**
     * Trigger standalone biometric authentication (no key retrieval).
     * This is used for re-authentication before sensitive operations.
     * @param title The title to show in the biometric prompt
     * @param callback The callback to handle the result
     */
    fun authenticateWithBiometric(title: String, callback: BiometricAuthCallback)
}

/**
 * Callback interface for standalone biometric authentication.
 */
interface BiometricAuthCallback {
    /**
     * Called when authentication succeeds.
     */
    fun onSuccess()

    /**
     * Called when authentication fails or is cancelled.
     */
    fun onFailure()
}

/**
 * Callback interface for keystore operations.
 */
interface KeystoreOperationCallback {
    /**
     * Called when the operation is successful.
     * @param result The result of the operation
     */
    fun onSuccess(result: String)

    /**
     * Called when the operation fails.
     * @param e The exception that occurred
     */
    fun onError(e: Exception)
}
