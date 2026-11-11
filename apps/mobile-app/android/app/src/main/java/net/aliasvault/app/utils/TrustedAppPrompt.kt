package net.aliasvault.app.utils

import android.app.Activity
import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.net.Uri
import android.text.SpannableString
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StyleSpan
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.widget.FrameLayout
import net.aliasvault.app.R
import net.aliasvault.app.credentialprovider.OriginVerifier

/**
 * Texts and the store action for offering to trust an app AliasVault cannot verify, shared by the autofill picker and the passkey screens.
 */
object TrustedAppPrompt {
    private const val TAG = "TrustedAppPrompt"
    private val PLACEHOLDER = Regex("%(\\d+)\\\$s|%%")

    /** The launcher label of [packageName], or the package name itself when the app is not visible. */
    fun appLabel(context: Context, packageName: String): String {
        val packageManager = context.packageManager
        return runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0)).toString() }.getOrDefault(packageName)
    }

    /** The launcher icon of [packageName], or the default app icon when the app is not visible. */
    fun appIcon(context: Context, packageName: String): Drawable {
        val packageManager = context.packageManager
        return runCatching { packageManager.getApplicationIcon(packageName) }.getOrDefault(packageManager.defaultActivityIcon)
    }

    /** Label of the "Trust <app>" action. */
    fun actionLabel(context: Context, packageName: String): String = context.getString(R.string.autofill_trust_app, appLabel(context, packageName))

    /** Warning shown before the user trusts an app for [site], a URL or host the app claims to show, with the site in bold. */
    fun message(context: Context, site: String): CharSequence {
        val domain = SpannableString(Uri.parse(site).host ?: site)
        domain.setSpan(StyleSpan(Typeface.BOLD), 0, domain.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        return format(context.getString(R.string.autofill_trust_app_message), domain)
    }

    /** The card naming [packageName], shown next to [message]. */
    fun appCard(context: Context, packageName: String): ErrorScreenView.AppCard {
        return ErrorScreenView.AppCard(appLabel(context, packageName), packageName, appIcon(context, packageName))
    }

    /** The card of [packageName] as a view for a dialog, indented like the dialog's message. */
    fun appCardView(context: Context, packageName: String): View {
        val padding = context.resources.getDimensionPixelSize(R.dimen.dialog_content_padding)
        return FrameLayout(context).apply {
            setPadding(padding, padding / 2, padding, 0)
            appCard(context, packageName).bindTo(LayoutInflater.from(context).inflate(R.layout.app_card, this, true))
        }
    }

    /** Store [packageName] as a trusted app, bound to [signers]: the certificates of the request the user is answering. */
    fun trust(context: Context, packageName: String, signers: AppSigners) {
        TrustedAppStore.trust(context, packageName, signers, appLabel(context, packageName))
        Log.i(TAG, "User trusted $packageName")
    }

    /**
     * Show the error screen of `activity_loading.xml` with the warning for the [caller] of a passkey request and a button that
     * trusts it and runs [onTrusted].
     */
    fun showOnErrorScreen(
        activity: Activity,
        caller: OriginVerifier.OriginResult.UntrustedApp,
        site: String,
        onClose: () -> Unit,
        onTrusted: () -> Unit,
    ) {
        val action = ErrorScreenView.Action(actionLabel(activity, caller.packageName)) {
            trust(activity, caller.packageName, caller.signers)
            ErrorScreenView.showLoading(activity)
            onTrusted()
        }
        val title = activity.getString(R.string.autofill_trust_app_title)
        val content = ErrorScreenView.Content(message(activity, site), title, action = action, app = appCard(activity, caller.packageName))
        ErrorScreenView.show(activity, content, onClose)
    }

    /** [template] with its `%1$s`-style placeholders replaced by [args], keeping the spans of the arguments. */
    private fun format(template: String, vararg args: CharSequence): CharSequence {
        val result = SpannableStringBuilder()
        var last = 0
        for (match in PLACEHOLDER.findAll(template)) {
            result.append(template, last, match.range.first)
            val position = match.groupValues[1]
            result.append(if (position.isEmpty()) "%" else args.getOrNull(position.toInt() - 1) ?: match.value)
            last = match.range.last + 1
        }
        return result.append(template, last, template.length)
    }
}
