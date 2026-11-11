package net.aliasvault.app.credentialprovider

import android.app.Activity
import android.net.Uri
import net.aliasvault.app.R
import net.aliasvault.app.utils.ErrorScreenView
import net.aliasvault.app.utils.TrustedAppPrompt

/**
 * Error screen for a passkey request AliasVault refused after origin verification failed.
 */
object OriginBlockedScreen {

    /**
     * Show the blocked screen for the caller [packageName] (null when unknown) that asked for [site], a URL or host.
     */
    fun show(activity: Activity, packageName: String?, site: String, reason: String, onClose: () -> Unit) {
        // The package is only unknown below Android 14, where the credential provider never runs.
        val app = packageName?.let { TrustedAppPrompt.appLabel(activity, it) } ?: "unknown"
        val domain = Uri.parse(site).host ?: site
        val content = ErrorScreenView.Content(
            message = activity.getString(R.string.passkey_blocked_message, app, domain),
            title = activity.getString(R.string.passkey_blocked_title),
            detail = "Reason: $reason\nApp: ${packageName ?: "unknown"}\nSite: $site",
        )
        ErrorScreenView.show(activity, content, onClose)
    }
}
