package net.aliasvault.app.autofill.utils

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BlendMode
import android.graphics.drawable.Icon
import android.service.autofill.InlinePresentation
import android.util.Log
import android.widget.inline.InlinePresentationSpec
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi
import net.aliasvault.app.MainActivity
import net.aliasvault.app.R

/**
 * Builds [InlinePresentation] objects for keyboard inline autofill suggestions.
 * The IME renders these alongside its own toolbar so users can pick a credential
 * without ever opening the autofill dropdown.
 */
@SuppressLint("RestrictedApi")
object InlinePresentationHelper {
    private const val TAG = "AliasVaultAutofill"

    /**
     * Default attribution target — used when a caller does not supply a more
     * specific deep link. Long-pressing the inline chip launches MainActivity.
     */
    private fun defaultAttributionIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * Build a long-press attribution PendingIntent that opens the given
     * deep link (e.g. `aliasvault://items/<id>`). [requestCode] should be
     * unique per destination so PendingIntent caching does not collapse
     * separate items onto the same intent.
     */
    fun attributionPendingIntent(context: Context, deepLinkUri: String, requestCode: Int): PendingIntent {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = android.net.Uri.parse(deepLinkUri)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return PendingIntent.getActivity(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * Returns true if the IME-provided [spec] supports the v1 inline UI
     * surface we know how to build for.
     */
    fun supportsV1(spec: InlinePresentationSpec): Boolean {
        return try {
            UiVersions.getVersions(spec.style).contains(UiVersions.INLINE_UI_VERSION_1)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to read inline spec versions", e)
            false
        }
    }

    /**
     * Visual payload for a credential inline chip.
     *
     * @property title Primary line (typically the credential name).
     * @property subtitle Secondary line (typically username or email); omitted if null/empty.
     * @property icon Start-chip icon (typically the site logo); omitted if null.
     */
    data class CredentialContent(val title: String, val subtitle: String?, val icon: Bitmap?)

    /**
     * Build an inline presentation for a credential row. The icon, when
     * provided, is shown as the start chip.
     */
    fun buildCredentialPresentation(
        context: Context,
        spec: InlinePresentationSpec,
        content: CredentialContent,
        attributionIntent: PendingIntent? = null,
    ): InlinePresentation? {
        if (!supportsV1(spec)) {
            return null
        }
        return try {
            val contentBuilder = InlineSuggestionUi
                .newContentBuilder(attributionIntent ?: defaultAttributionIntent(context))
                .setTitle(content.title)
                .setContentDescription(content.title)
            if (!content.subtitle.isNullOrEmpty()) {
                contentBuilder.setSubtitle(content.subtitle)
            }
            if (content.icon != null) {
                val icon = Icon.createWithBitmap(content.icon)
                icon.setTintBlendMode(BlendMode.DST)
                contentBuilder.setStartIcon(icon)
            }
            InlinePresentation(contentBuilder.build().slice, spec, false)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to build inline credential presentation", e)
            null
        }
    }

    /**
     * Hands out inline-presentation specs in dataset-add order, honouring the
     * IME's maxSuggestionCount cap. Returns null once the budget is spent so
     * callers can skip the inline call without changing the dropdown path.
     */
    class SpecPool(private val specs: List<InlinePresentationSpec>, maxCount: Int) {
        private val budget: Int = minOf(maxCount, MAX_INLINE_BUDGET).coerceAtLeast(0)
        private var consumed: Int = 0

        /**
         * Returns the next spec for an inline suggestion, or null if the
         * caller should fall back to a dropdown-only dataset.
         */
        fun next(): InlinePresentationSpec? {
            if (specs.isEmpty() || consumed >= budget) {
                return null
            }
            val spec = specs.getOrElse(consumed) { specs.last() }
            consumed++
            return spec
        }

        companion object {
            private const val MAX_INLINE_BUDGET = 20
        }
    }

    /**
     * Build an inline presentation for an action chip (open app, no match,
     * vault locked, etc). Uses the AliasVault launcher icon.
     */
    fun buildActionPresentation(
        context: Context,
        spec: InlinePresentationSpec,
        title: String,
    ): InlinePresentation? {
        if (!supportsV1(spec)) {
            return null
        }
        return try {
            val icon = Icon.createWithResource(context, R.drawable.av_logo)
            val content = InlineSuggestionUi.newContentBuilder(defaultAttributionIntent(context))
                .setTitle(title)
                .setContentDescription(title)
                .setStartIcon(icon)
                .build()
            InlinePresentation(content.slice, spec, false)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to build inline action presentation", e)
            null
        }
    }
}
