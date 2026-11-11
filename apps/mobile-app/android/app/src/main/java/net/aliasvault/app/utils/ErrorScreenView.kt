package net.aliasvault.app.utils

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.util.Log
import android.view.View
import android.widget.TextView
import android.widget.Toast
import com.google.android.material.button.MaterialButton
import net.aliasvault.app.R

/**
 * Shared helper for the error state of the `activity_loading.xml` layout used by
 * the native unlock / passkey / autofill activities.
 *
 * Includes a user facing error that can be expanded and copied.
 */
object ErrorScreenView {
    private const val TAG = "ErrorScreenView"
    private const val CLIP_LABEL = "AliasVault error detail"

    /**
     * An extra button shown above Close.
     * @property label Button text.
     * @property onClick Invoked when the user taps the button.
     */
    class Action(val label: String, val onClick: () -> Unit)

    /**
     * What the error state shows.
     * @property message User-facing error message.
     * @property title Optional bold heading above the message.
     * @property detail Optional technical detail behind the "Show details" toggle, copyable to the clipboard.
     * @property action Optional extra button shown above Close.
     */
    class Content(val message: String, val title: String? = null, val detail: String? = null, val action: Action? = null)

    /**
     * Populate and reveal the error state with a plain message.
     *
     * @param activity Hosting activity whose current content view exposes the
     *   `activity_loading.xml` error view ids (errorContainer, errorMessage,
     *   closeButton and the optional errorDetails* views).
     * @param message User-facing error message.
     * @param detail Optional technical detail shown behind the "Show details"
     *   toggle and copyable to the clipboard. The toggle stays hidden when this
     *   is null or blank.
     * @param onClose Invoked when the user taps Close, and as a fallback if the
     *   error UI itself fails to render.
     */
    fun show(activity: Activity, message: String, detail: String? = null, onClose: () -> Unit) {
        show(activity, Content(message, detail = detail), onClose)
    }

    /** Populate and reveal the error state with [content]; [onClose] runs on Close and when the error UI fails to render. */
    fun show(activity: Activity, content: Content, onClose: () -> Unit) {
        activity.runOnUiThread {
            try {
                activity.findViewById<View>(R.id.loadingIndicator)?.visibility = View.GONE
                activity.findViewById<View>(R.id.errorContainer)?.visibility = View.VISIBLE
                activity.findViewById<TextView>(R.id.errorMessage)?.text = content.message
                activity.findViewById<MaterialButton>(R.id.closeButton)?.setOnClickListener { onClose() }
                bindTitle(activity, content.title)
                bindAction(activity, content.action)
                bindDetail(activity, content.detail)
            } catch (e: Exception) {
                Log.e(TAG, "Error showing error UI", e)
                onClose()
            }
        }
    }

    private fun bindTitle(activity: Activity, title: String?) {
        val view = activity.findViewById<TextView>(R.id.errorTitle) ?: return
        view.text = title
        view.visibility = if (title.isNullOrBlank()) View.GONE else View.VISIBLE
    }

    /** Hide the error state again and show the loading indicator, for a retry after the user resolved the error. */
    fun showLoading(activity: Activity) {
        activity.runOnUiThread {
            activity.findViewById<View>(R.id.errorContainer)?.visibility = View.GONE
            activity.findViewById<View>(R.id.loadingIndicator)?.visibility = View.VISIBLE
        }
    }

    private fun bindAction(activity: Activity, action: Action?) {
        val button = activity.findViewById<MaterialButton>(R.id.errorActionButton) ?: return
        if (action == null) {
            button.visibility = View.GONE
            return
        }
        button.text = action.label
        button.visibility = View.VISIBLE
        button.setOnClickListener { action.onClick() }
    }

    /**
     * Build a copy-pasteable diagnostic string for a failure: app/device context
     * plus the full stack trace. Intended to be passed as [show]'s `detail`.
     *
     * @param context Hosting context, used to read the app version.
     * @param throwable The failure to describe.
     * @param extraContext Optional caller-specific context line, e.g.
     *   "App: example.com, fields=2".
     */
    fun buildDiagnosticDetail(context: Context, throwable: Throwable, extraContext: String? = null): String {
        return buildString {
            appendLine("App version: ${appVersion(context)}")
            appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL}")
            appendLine("Android: ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
            if (!extraContext.isNullOrBlank()) {
                appendLine(extraContext)
            }
            appendLine()
            append(Log.getStackTraceString(throwable))
        }
    }

    /**
     * Wire the collapsible technical-detail section. Keeps the toggle hidden when
     * there is nothing useful to share, so callers that pass no detail get the
     * plain message-and-close error screen.
     */
    private fun bindDetail(activity: Activity, detail: String?) {
        val toggle = activity.findViewById<MaterialButton>(R.id.errorDetailsToggle)
        val container = activity.findViewById<View>(R.id.errorDetailsContainer)
        val detailText = activity.findViewById<TextView>(R.id.errorDetailsText)
        val copyButton = activity.findViewById<MaterialButton>(R.id.errorDetailsCopyButton)
        if (toggle == null || container == null || detailText == null || copyButton == null) { return }

        if (detail.isNullOrBlank()) {
            toggle.visibility = View.GONE
            container.visibility = View.GONE
            return
        }

        detailText.text = detail
        toggle.visibility = View.VISIBLE
        container.visibility = View.GONE
        toggle.setText(R.string.common_show_details)

        toggle.setOnClickListener {
            val expanded = container.visibility == View.VISIBLE
            container.visibility = if (expanded) View.GONE else View.VISIBLE
            toggle.setText(if (expanded) R.string.common_show_details else R.string.common_hide_details)
        }

        copyButton.setOnClickListener {
            try {
                val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText(CLIP_LABEL, detail))
                Toast.makeText(activity, R.string.common_copied_to_clipboard, Toast.LENGTH_SHORT).show()
            } catch (e: Exception) {
                Log.e(TAG, "Error copying error detail to clipboard", e)
            }
        }
    }

    private fun appVersion(context: Context): String {
        return try {
            val pkg = context.packageManager.getPackageInfo(context.packageName, 0)
            "${pkg.versionName} (${pkg.longVersionCode})"
        } catch (e: Exception) {
            Log.e(TAG, "Error reading app version", e)
            "unknown"
        }
    }
}
