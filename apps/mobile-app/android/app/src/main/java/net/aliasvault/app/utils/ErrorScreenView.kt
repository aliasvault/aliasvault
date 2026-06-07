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
     * Populate and reveal the error state.
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
        activity.runOnUiThread {
            try {
                activity.findViewById<View>(R.id.loadingIndicator)?.visibility = View.GONE
                activity.findViewById<View>(R.id.errorContainer)?.visibility = View.VISIBLE
                activity.findViewById<TextView>(R.id.errorMessage)?.text = message
                activity.findViewById<MaterialButton>(R.id.closeButton)?.setOnClickListener { onClose() }
                bindDetail(activity, detail)
            } catch (e: Exception) {
                Log.e(TAG, "Error showing error UI", e)
                onClose()
            }
        }
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
