package net.aliasvault.app.vaultstore

import android.util.Base64
import android.util.Log
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreProvider

/**
 * Legacy conversion of a stored unlock key to the Account Key.
 *
 * Before 0.31.0 the keystore and the PIN protected the unlock key (the Argon2id output of the master password). Since
 * then they protect the Account Key. A key stored before the account had a key chain (a 0.30.x install, or an account
 * upgraded on another device) still opens the chain; these helpers then store the Account Key in its place, once.
 *
 * TODO: remove once accounts without a key chain (pre-0.31.0) are no longer supported.
 */
internal object LegacyKeyConversion {
    private const val TAG = "LegacyKeyConversion"

    /**
     * Re-encrypt the PIN with the Account Key when it still protected an unlock key.
     */
    fun convertPinKey(pin: VaultPin, pinValue: String, pinKey: String, accountKey: String) {
        if (accountKey == pinKey) {
            return
        }
        try {
            pin.setupPin(pinValue, accountKey)
        } catch (e: Exception) {
            Log.w(TAG, "Could not re-encrypt the PIN key, will retry on the next PIN unlock", e)
        }
    }

    /**
     * Store the Account Key in the keystore when it still held an unlock key.
     */
    fun convertKeystoreKey(keystoreProvider: KeystoreProvider, keystoreKey: ByteArray, accountKey: ByteArray) {
        if (accountKey.contentEquals(keystoreKey)) {
            return
        }
        keystoreProvider.storeKey(
            key = Base64.encodeToString(accountKey, Base64.NO_WRAP),
            object : KeystoreOperationCallback {
                override fun onSuccess(result: String) {
                    Log.d(TAG, "Replaced the keystore unlock key with the account key")
                }

                override fun onError(e: Exception) {
                    Log.d(TAG, "Could not replace the keystore unlock key yet: ${e.message}")
                }
            },
        )
    }
}
