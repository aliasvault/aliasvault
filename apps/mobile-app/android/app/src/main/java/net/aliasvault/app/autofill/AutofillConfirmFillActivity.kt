package net.aliasvault.app.autofill

import android.os.Bundle
import android.util.Log
import android.view.autofill.AutofillId
import androidx.fragment.app.FragmentActivity
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import net.aliasvault.app.R
import net.aliasvault.app.autofill.models.FieldType
import net.aliasvault.app.autofill.utils.AutofillDatasetBuilder
import net.aliasvault.app.autofill.utils.AutofillFieldExtras
import net.aliasvault.app.autofill.utils.BrowserAllowlist
import net.aliasvault.app.utils.TrustedAppPrompt
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.webapi.WebApiService

/**
 * Confirmation before a website login fills into a web page reported by an app AliasVault cannot verify.
 * The user can also make it stick: a browser is trusted for every site, any other app is added to the item.
 */
class AutofillConfirmFillActivity : FragmentActivity() {

    companion object {
        private const val TAG = "AliasVaultAutofill"
        private const val SYNC_TIMEOUT_MS = 10_000L

        /** Package name of the app showing the page. */
        const val EXTRA_PACKAGE_NAME = "net.aliasvault.app.autofill.confirm.EXTRA_PACKAGE_NAME"

        /** The site the page reports, set only when the app is a browser. */
        const val EXTRA_BROWSER_SITE = "net.aliasvault.app.autofill.confirm.EXTRA_BROWSER_SITE"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val itemId = intent.getStringExtra(AutofillFillActivity.EXTRA_ITEM_ID)
        val manifestId = intent.getStringExtra(AutofillFillActivity.EXTRA_MANIFEST_ID)
        val fields = AutofillFieldExtras.read(intent, AutofillFillActivity.EXTRA_AUTOFILL_IDS, AutofillFillActivity.EXTRA_FIELD_TYPES)
        val packageName = intent.getStringExtra(EXTRA_PACKAGE_NAME)
        if (itemId == null || manifestId == null || fields == null || packageName.isNullOrEmpty()) {
            Log.w(TAG, "AutofillConfirmFillActivity: missing or mismatched extras, finishing")
            cancelAndFinish()
            return
        }

        val store = VaultStore.getExistingInstance()?.takeIf { it.isVaultUnlocked() }
        val item = store?.getAllItems()?.firstOrNull {
            it.id.toString().equals(itemId, ignoreCase = true) && it.manifestId.equals(manifestId, ignoreCase = true)
        }
        if (store == null || item == null) {
            Log.w(TAG, "AutofillConfirmFillActivity: vault locked or item not found, finishing")
            cancelAndFinish()
            return
        }

        // Trusted or linked earlier in this session, whose cached rows still point here: fill without asking.
        val browserSite = intent.getStringExtra(EXTRA_BROWSER_SITE)
        val alreadyConfirmed = if (browserSite != null) BrowserAllowlist.isTrustedApp(this, packageName) else item.urls.any { it.trim() == packageName }
        if (alreadyConfirmed) {
            fill(store, item, fields)
            return
        }

        val dialog = MaterialAlertDialogBuilder(this).setTitle(getString(R.string.autofill_confirm_fill_title, TrustedAppPrompt.appLabel(this, packageName)))
        if (browserSite != null) {
            dialog.setMessage(TrustedAppPrompt.message(this, packageName, browserSite))
                .setPositiveButton(TrustedAppPrompt.actionLabel(this, packageName)) { _, _ -> trustAndFill(store, item, packageName, fields) }
        } else {
            dialog.setMessage(getString(R.string.link_url_prompt_message, packageName, item.name.orEmpty()))
                .setPositiveButton(R.string.link_url_prompt_link_action) { _, _ -> linkAndFill(store, item, packageName, fields) }
        }
        dialog.setNeutralButton(R.string.link_url_prompt_skip_action) { _, _ -> fill(store, item, fields) }
            .setNegativeButton(R.string.common_cancel) { _, _ -> cancelAndFinish() }
            .setOnCancelListener { cancelAndFinish() }
            .show()
    }

    private fun fill(store: VaultStore, item: Item, fields: List<Pair<AutofillId, FieldType>>) {
        val copyTotp = intent.getBooleanExtra(AutofillFillActivity.EXTRA_COPY_TOTP, false)
        setResult(RESULT_OK, AutofillDatasetBuilder.createPickedItemResult(this, store, item, fields, copyTotp))
        finish()
    }

    /**
     * Trust the browser [packageName] for every site and fill.
     */
    private fun trustAndFill(store: VaultStore, item: Item, packageName: String, fields: List<Pair<AutofillId, FieldType>>) {
        TrustedAppPrompt.trust(this, packageName)
        fill(store, item, fields)
    }

    /**
     * Add [packageName] to the item's URLs and fill; the change is pushed in the background and stays pending when that fails.
     */
    private fun linkAndFill(store: VaultStore, item: Item, packageName: String, fields: List<Pair<AutofillId, FieldType>>) {
        val linked = try {
            store.appendUrl(item.id, item.manifestId, packageName)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to link $packageName to the item", e)
            false
        }
        fill(store, item, fields)
        if (linked) {
            pushInBackground(store)
        }
    }

    private fun pushInBackground(store: VaultStore) {
        val webApiService = WebApiService(applicationContext)
        CoroutineScope(Dispatchers.IO).launch {
            try {
                withTimeoutOrNull(SYNC_TIMEOUT_MS) { store.mutateVault(webApiService) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "Sync after linking failed, the next sync pushes it", e)
            }
        }
    }

    private fun cancelAndFinish() {
        setResult(RESULT_CANCELED)
        finish()
    }
}
