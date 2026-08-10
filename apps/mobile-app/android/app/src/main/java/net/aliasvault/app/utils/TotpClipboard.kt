package net.aliasvault.app.utils

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import android.util.Log
import net.aliasvault.app.vaultstore.VaultStore

/**
 * Puts an item's current TOTP code on the clipboard while autofilling, so the user can paste it
 * into the 2FA field after the fill completes.
 */
object TotpClipboard {
    private const val TAG = "TotpClipboard"

    /** Shared preferences file holding the app's autofill settings. */
    private const val PREFS_NAME = "AliasVaultPrefs"

    /** Preference key for the copy-TOTP-on-fill setting. */
    private const val PREF_COPY_TOTP_ON_FILL = "autofill_copy_totp_on_fill"

    /**
     * Whether the user wants the item's TOTP code copied to the clipboard on autofill.
     * Defaults to true when the setting has never been written.
     */
    fun isCopyOnFillEnabled(context: Context): Boolean {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(PREF_COPY_TOTP_ON_FILL, true)
    }

    /**
     * Copy the current TOTP code of the passed item to the clipboard.
     *
     * @param context The context used for the clipboard service.
     * @param store The unlocked vault store to read the TOTP secret from.
     * @param itemId The ID of the item being filled.
     */
    fun copyCodeForItem(context: Context, store: VaultStore, itemId: String) {
        val totp = store.getTotpForItem(itemId) ?: return
        val code = TotpGenerator.generateCode(
            secret = totp.secretKey,
            period = totp.period,
            digits = totp.digits,
            algorithm = totp.algorithm,
        ) ?: return
        if (code.isEmpty()) return

        try {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("AliasVault", code)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val extras = PersistableBundle().apply {
                    putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
                }
                clip.description.extras = extras
            }
            clipboard.setPrimaryClip(clip)
            Log.d(TAG, "TOTP code copied to clipboard during autofill")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to copy TOTP code to clipboard", e)
        }
    }
}
