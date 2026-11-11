package net.aliasvault.app.utils

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.util.Log
import net.aliasvault.app.R
import net.aliasvault.app.autofill.utils.BrowserAllowlist

/**
 * Texts and the store action for offering to trust an app AliasVault cannot verify, shared by the autofill picker and the passkey screens.
 */
object TrustedAppPrompt {
    private const val TAG = "TrustedAppPrompt"

    /** The launcher label of [packageName], or the package name itself when the app is not visible. */
    fun appLabel(context: Context, packageName: String): String {
        val packageManager = context.packageManager
        return runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0)).toString() }.getOrDefault(packageName)
    }

    /** Label of the "Trust <app> for websites" action. */
    fun actionLabel(context: Context, packageName: String): String = context.getString(R.string.autofill_trust_app, appLabel(context, packageName))

    /** Warning shown before the user trusts [packageName] for [site], a URL or host the app claims to show. */
    fun message(context: Context, packageName: String, site: String): String {
        val domain = Uri.parse(site).host ?: site
        return context.getString(R.string.autofill_trust_app_message, appLabel(context, packageName), packageName, domain)
    }

    /** Store [packageName] with its current signing certificate as a trusted app; false when the certificate cannot be read. */
    fun trust(context: Context, packageName: String): Boolean {
        val fingerprints = BrowserAllowlist.installedFingerprints(context, packageName)
        if (fingerprints.isNullOrEmpty()) {
            Log.w(TAG, "No signing certificate for $packageName, not trusting it")
            return false
        }
        TrustedAppStore.trust(context, packageName, fingerprints.last(), appLabel(context, packageName))
        Log.i(TAG, "User trusted $packageName")
        return true
    }

    /**
     * Show the error screen of `activity_loading.xml` with the warning for [packageName] and a button that trusts it and runs [onTrusted].
     */
    fun showOnErrorScreen(activity: Activity, packageName: String, site: String, onClose: () -> Unit, onTrusted: () -> Unit) {
        val action = ErrorScreenView.Action(actionLabel(activity, packageName)) {
            if (trust(activity, packageName)) {
                ErrorScreenView.showLoading(activity)
                onTrusted()
            } else {
                onClose()
            }
        }
        val title = activity.getString(R.string.autofill_trust_app_title)
        ErrorScreenView.show(activity, ErrorScreenView.Content(message(activity, packageName, site), title, action = action), onClose)
    }
}
