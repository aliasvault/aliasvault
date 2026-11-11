package net.aliasvault.app.autofill

import android.app.Activity
import android.os.Bundle
import android.util.Log
import net.aliasvault.app.autofill.utils.AutofillDatasetBuilder
import net.aliasvault.app.autofill.utils.AutofillFieldExtras
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

        /** Intent extra for the manifest the item belongs to; only (manifest, id) names one item. */
        const val EXTRA_MANIFEST_ID = "net.aliasvault.app.autofill.EXTRA_MANIFEST_ID"

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
            val manifestId = intent.getStringExtra(EXTRA_MANIFEST_ID)
            val fields = AutofillFieldExtras.read(intent, EXTRA_AUTOFILL_IDS, EXTRA_FIELD_TYPES)
            if (itemId == null || manifestId == null || fields == null) {
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

            val item = store.getAllItems().firstOrNull {
                it.id.toString().equals(itemId, ignoreCase = true) && it.manifestId.equals(manifestId, ignoreCase = true)
            }
            if (item == null) {
                Log.w(TAG, "AutofillFillActivity: item not found, finishing")
                setResult(RESULT_CANCELED)
                finish()
                return
            }

            val copyTotp = intent.getBooleanExtra(EXTRA_COPY_TOTP, false)
            setResult(RESULT_OK, AutofillDatasetBuilder.createPickedItemResult(this, store, item, fields, copyTotp))
        } catch (e: Exception) {
            Log.e(TAG, "AutofillFillActivity error", e)
            setResult(RESULT_CANCELED)
        }
        finish()
    }
}
