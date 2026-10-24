package net.aliasvault.app.vaultstore

import android.util.Base64
import android.util.Log
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreOperationCallback
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreProvider

/**
 * Legacy conversion of a stored unlock key to the Account Key.
 *
 * The keystore and the PIN protect the Account Key, the one secret an unlocked session holds. Before 0.31.0 they
 * protected the unlock key (the Argon2id output of the master password). A key stored then (a 0.30.x install, or an
 * account upgraded on another device) still opens the account key chain, as an unlock key; these helpers then store the
 * Account Key in its place, once. For an account without a key chain the stored key is the vault key.
 *
 * Other platform implementations: VaultStore+LegacyKeyConversion.swift (iOS), LegacyKeyConversion.ts (core/client and browser extension).
 *
 * TODO: remove once accounts without a key chain (pre-0.31.0) are no longer supported; [openStoredKey] then becomes
 * [VaultCrypto.openKeyChainWithAccountKey].
 */
internal object LegacyKeyConversion {
    private const val TAG = "LegacyKeyConversion"

    /**
     * Open the cached account key chain with a key the keystore, the PIN or the session stored: the Account Key, or the
     * unlock key a store written before the account had a key chain holds.
     */
    fun openStoredKey(crypto: VaultCrypto, key: ByteArray): VaultCrypto.SessionKeys {
        return try {
            crypto.openKeyChainWithAccountKey(key)
        } catch (_: AppError.UnlockKeyRejected) {
            // LEGACY: the stored key is an unlock key; the caller stores the Account Key the chain yields in its place.
            crypto.openKeyChainWithUnlockKey(key)
        }
    }

    /**
     * Re-encrypt the PIN with the Account Key when it still protected an unlock key.
     */
    fun convertLegacyPinKey(pin: VaultPin, pinValue: String, pinKey: String, accountKey: String) {
        if (accountKey == pinKey) {
            return
        }
        try {
            pin.encryptKeyWithPin(Base64.decode(accountKey, Base64.NO_WRAP), pinValue)
        } catch (e: Exception) {
            Log.w(TAG, "Could not re-encrypt the PIN key, will retry on the next PIN unlock", e)
        }
    }

    /**
     * Store the Account Key in the keystore when it still held an unlock key.
     */
    fun convertLegacyKeystoreKey(keystoreProvider: KeystoreProvider, keystoreKey: ByteArray, accountKey: ByteArray) {
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
