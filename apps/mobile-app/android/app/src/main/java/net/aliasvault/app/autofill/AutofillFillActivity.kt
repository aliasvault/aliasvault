package net.aliasvault.app.autofill

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.autofill.Dataset
import android.util.Log
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.widget.RemoteViews
import net.aliasvault.app.R
import net.aliasvault.app.autofill.models.FieldType
import net.aliasvault.app.autofill.utils.AutofillFieldMapper
import net.aliasvault.app.utils.TotpClipboard
import net.aliasvault.app.vaultstore.VaultStore

/**
 * Transparent activity launched by the OS when the user picks an autofill
 * credential row (wired via `Dataset.setAuthentication(IntentSender)`).
 * Optionally copies the item's current TOTP code to the clipboard when
 * [EXTRA_COPY_TOTP] is set, then builds the fill `Dataset` from the item's
 * stored values and returns it via `AutofillManager.EXTRA_AUTHENTICATION_RESULT`.
 */
class AutofillFillActivity : Activity() {

    companion object {
        private const val TAG = "AliasVaultAutofill"

        /** Intent extra for the vault item ID whose credentials should be filled. */
        const val EXTRA_ITEM_ID = "net.aliasvault.app.autofill.EXTRA_ITEM_ID"

        /** Intent extra holding the parceled `AutofillId`s for the target form fields. */
        const val EXTRA_AUTOFILL_IDS = "net.aliasvault.app.autofill.EXTRA_AUTOFILL_IDS"

        /** Intent extra holding the `FieldType` ordinals matching `EXTRA_AUTOFILL_IDS` one-to-one. */
        const val EXTRA_FIELD_TYPES = "net.aliasvault.app.autofill.EXTRA_FIELD_TYPES"

        /** Intent extra controlling whether the item's current TOTP code is copied to the clipboard. */
        const val EXTRA_COPY_TOTP = "net.aliasvault.app.autofill.EXTRA_COPY_TOTP"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            val itemId = intent.getStringExtra(EXTRA_ITEM_ID)
            val autofillIds = parseAutofillIds(intent)
            val fieldTypeOrdinals = intent.getIntArrayExtra(EXTRA_FIELD_TYPES)
            val copyTotp = intent.getBooleanExtra(EXTRA_COPY_TOTP, false)

            if (itemId == null || autofillIds == null || fieldTypeOrdinals == null ||
                autofillIds.size != fieldTypeOrdinals.size
            ) {
                Log.w(TAG, "AutofillFillActivity: missing or mismatched extras, finishing")
                setResult(RESULT_CANCELED)
                finish()
                return
            }

            val store = VaultStore.getExistingInstance()
            if (store == null || !store.isVaultUnlocked()) {
                Log.w(TAG, "AutofillFillActivity: vault not available, finishing")
                setResult(RESULT_CANCELED)
                finish()
                return
            }

            val item = store.getAllItems().firstOrNull { it.id.toString().equals(itemId, ignoreCase = true) }
            if (item == null) {
                Log.w(TAG, "AutofillFillActivity: item not found, finishing")
                setResult(RESULT_CANCELED)
                finish()
                return
            }

            if (copyTotp) {
                TotpClipboard.copyCodeForItem(this, store, itemId)
            }

            val fields = pairFields(autofillIds, fieldTypeOrdinals)
            // Presentation passed to the inner Dataset.Builder is never displayed
            // — the OS already showed the outer dataset's presentation in the
            // picker — but the legacy constructor requires a valid RemoteViews.
            val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item_icon)
            val builder = Dataset.Builder(presentation)
            AutofillFieldMapper.applyItem(builder, item, fields)

            val resultIntent = Intent().apply {
                putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, builder.build())
            }
            setResult(RESULT_OK, resultIntent)
        } catch (e: Exception) {
            Log.e(TAG, "AutofillFillActivity error", e)
            setResult(RESULT_CANCELED)
        }
        finish()
    }

    @Suppress("DEPRECATION")
    private fun parseAutofillIds(intent: Intent): Array<AutofillId>? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableArrayExtra(EXTRA_AUTOFILL_IDS, AutofillId::class.java)
        } else {
            intent.getParcelableArrayExtra(EXTRA_AUTOFILL_IDS)
                ?.mapNotNull { it as? AutofillId }
                ?.toTypedArray()
        }
    }

    private fun pairFields(
        autofillIds: Array<AutofillId>,
        fieldTypeOrdinals: IntArray,
    ): List<Pair<AutofillId, FieldType>> {
        val types = FieldType.values()
        return autofillIds.mapIndexed { i, id ->
            id to (types.getOrNull(fieldTypeOrdinals[i]) ?: FieldType.UNKNOWN)
        }
    }
}
