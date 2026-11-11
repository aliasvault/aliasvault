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
        val domain = Uri.parse(site).host ?: site
        val message = packageName?.let { activity.getString(R.string.passkey_blocked_message, TrustedAppPrompt.appLabel(activity, it), domain) }
        val content = ErrorScreenView.Content(
            message = message ?: activity.getString(R.string.unknown_error),
            title = activity.getString(R.string.passkey_blocked_title),
            detail = "Reason: $reason\nApp: ${packageName ?: "unknown"}\nSite: $site",
        )
        ErrorScreenView.show(activity, content, onClose)
    }
}
