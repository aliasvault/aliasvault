package net.aliasvault.app.autofill.utils

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.service.autofill.Dataset
import android.util.Log
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import android.widget.inline.InlinePresentationSpec
import net.aliasvault.app.R
import net.aliasvault.app.autofill.AutofillFillActivity
import net.aliasvault.app.autofill.models.FieldType
import net.aliasvault.app.utils.ItemTypeIcon
import net.aliasvault.app.vaultstore.models.Item
import java.net.URLEncoder

/**
 * Shared builders for rendering autofill picker rows.
 */
object AutofillDatasetBuilder {
    private const val TAG = "AliasVaultAutofill"

    /**
     * Build a Dataset for a single vault item shown in the autofill picker.
     *
     * The Dataset wires `setAuthentication` to [AutofillFillActivity], which is
     * responsible for performing the actual fill (and optionally copying the
     * TOTP code to the clipboard) once the user selects the row.
     */
    fun createItemDataset(
        context: Context,
        fields: List<Pair<AutofillId, FieldType>>,
        item: Item,
        copyTotpOnSelect: Boolean,
        inlineSpec: InlinePresentationSpec? = null,
    ): Dataset {
        val presentation = RemoteViews(context.packageName, R.layout.autofill_dataset_item_icon)
        val builder = Dataset.Builder(presentation)

        val applyResult = AutofillFieldMapper.applyItem(builder, item, fields)
        if (!applyResult.hasValue && fields.isNotEmpty()) {
            Log.w(TAG, "Item ${item.name} has no autofillable data - this should have been filtered")
            builder.setValue(fields.first().first, AutofillValue.forText(""))
        }

        val displayValue = if (applyResult.labelSuffix != null) {
            "${item.name} (${applyResult.labelSuffix})"
        } else {
            item.name
        }
        presentation.setTextViewText(R.id.text, displayValue)

        val bitmap = buildLogoBitmap(context, item, presentation)

        if (inlineSpec != null) {
            val itemDeepLink = "aliasvault://items/${item.id.toString().uppercase()}"
            val attribIntent = InlinePresentationHelper.attributionPendingIntent(
                context = context,
                deepLinkUri = itemDeepLink,
                requestCode = item.id.hashCode(),
            )
            val inline = InlinePresentationHelper.buildCredentialPresentation(
                context = context,
                spec = inlineSpec,
                content = InlinePresentationHelper.CredentialContent(
                    title = item.name.orEmpty(),
                    subtitle = applyResult.labelSuffix,
                    icon = bitmap,
                ),
                attributionIntent = attribIntent,
            )
            if (inline != null) {
                builder.setInlinePresentation(inline)
            }
        }

        val autofillIds = fields.map { it.first }.toTypedArray()
        val fieldTypeOrdinals = IntArray(fields.size) { i -> fields[i].second.ordinal }
        val authIntent = Intent(context, AutofillFillActivity::class.java).apply {
            putExtra(AutofillFillActivity.EXTRA_ITEM_ID, item.id.toString().uppercase())
            putExtra(AutofillFillActivity.EXTRA_AUTOFILL_IDS, autofillIds)
            putExtra(AutofillFillActivity.EXTRA_FIELD_TYPES, fieldTypeOrdinals)
            putExtra(AutofillFillActivity.EXTRA_COPY_TOTP, copyTotpOnSelect)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            item.id.hashCode(),
            authIntent,
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_CANCEL_CURRENT,
        )
        builder.setAuthentication(pendingIntent.intentSender)

        return builder.build()
    }

    /**
     * Resolve the row icon and apply it to [presentation], returning the bitmap
     * so it can be reused for the inline presentation.
     */
    private fun buildLogoBitmap(context: Context, item: Item, presentation: RemoteViews): Bitmap? {
        return try {
            val logoBytes = item.logo
            val bitmap = if (logoBytes != null) {
                ImageUtils.bytesToBitmap(logoBytes)
            } else {
                ItemTypeIcon.getIcon(
                    context = context,
                    itemType = ItemTypeIcon.ItemType.LOGIN,
                    size = 96,
                )
            }
            if (bitmap != null) {
                presentation.setImageViewBitmap(R.id.icon, bitmap)
            }
            bitmap
        } catch (e: Exception) {
            Log.w(TAG, "Failed to render logo for '${item.name}' - showing credential without it", e)
            null
        }
    }

    /**
     * Build a "No matches found" Dataset that deep-links into AliasVault's
     * action picker so the user can link the current site/app to an existing
     * credential or create a new one.
     */
    fun createNoMatchesDataset(
        context: Context,
        fields: List<Pair<AutofillId, FieldType>>,
        appInfo: String?,
        inlineSpec: InlinePresentationSpec? = null,
    ): Dataset {
        val label = context.getString(R.string.autofill_no_match_found)
        val presentation = RemoteViews(context.packageName, R.layout.autofill_dataset_item_logo)
        presentation.setTextViewText(R.id.text, label)

        val dataSetBuilder = Dataset.Builder(presentation)

        if (inlineSpec != null) {
            val inline = InlinePresentationHelper.buildActionPresentation(context, inlineSpec, label)
            if (inline != null) {
                dataSetBuilder.setInlinePresentation(inline)
            }
        }

        val encodedUrl = appInfo?.let { URLEncoder.encode(it, "UTF-8") } ?: ""
        val deepLinkUrl = "aliasvault://items/autofill-open-app?itemUrl=$encodedUrl"

        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = android.net.Uri.parse(deepLinkUrl)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        dataSetBuilder.setAuthentication(pendingIntent.intentSender)

        // Android requires at least one value to be set on a Dataset.
        for (field in fields) {
            dataSetBuilder.setValue(field.first, AutofillValue.forText(""))
        }

        return dataSetBuilder.build()
    }
}
