package net.aliasvault.app.autofill

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.autofill.FillResponse
import android.util.Log
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.aliasvault.app.R
import net.aliasvault.app.autofill.models.FieldType
import net.aliasvault.app.autofill.utils.AutofillDatasetBuilder
import net.aliasvault.app.autofill.utils.RustItemMatcher
import net.aliasvault.app.credentialprovider.UnlockCoordinator
import net.aliasvault.app.utils.ErrorScreenView
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider
import net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider

/**
 * Activity launched by the OS when the user taps the "Vault locked" entry in
 * the autofill picker (wired via `FillResponse.setAuthentication`).
 *
 * Drives the vault unlock through [UnlockCoordinator] (biometric → PIN →
 * master password) and, on success, builds a [FillResponse] of matching
 * credentials and returns it via `AutofillManager.EXTRA_AUTHENTICATION_RESULT`.
 * The OS then restores the calling app and re-shows the autofill picker so the
 * user can complete the fill without ever leaving the original app.
 */
class AutofillUnlockActivity : FragmentActivity() {

    companion object {
        private const val TAG = "AliasVaultAutofill"

        /** Parceled `AutofillId`s for the target form fields. */
        const val EXTRA_AUTOFILL_IDS = "net.aliasvault.app.autofill.unlock.EXTRA_AUTOFILL_IDS"

        /** `FieldType` ordinals matching [EXTRA_AUTOFILL_IDS] one-to-one. */
        const val EXTRA_FIELD_TYPES = "net.aliasvault.app.autofill.unlock.EXTRA_FIELD_TYPES"

        /** Resolved web origin or package name for the calling app/site, used for matching. */
        const val EXTRA_APP_INFO = "net.aliasvault.app.autofill.unlock.EXTRA_APP_INFO"
    }

    private lateinit var vaultStore: VaultStore
    private lateinit var unlockCoordinator: UnlockCoordinator

    private lateinit var fields: List<Pair<AutofillId, FieldType>>
    private var appInfo: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            val autofillIds = parseAutofillIds(intent)
            val fieldTypeOrdinals = intent.getIntArrayExtra(EXTRA_FIELD_TYPES)
            if (autofillIds == null || fieldTypeOrdinals == null ||
                autofillIds.size != fieldTypeOrdinals.size
            ) {
                Log.w(TAG, "AutofillUnlockActivity: missing or mismatched extras, finishing")
                cancelAndFinish()
                return
            }
            fields = pairFields(autofillIds, fieldTypeOrdinals)
            appInfo = intent.getStringExtra(EXTRA_APP_INFO)

            vaultStore = VaultStore.getExistingInstance() ?: run {
                val keystoreProvider = AndroidKeystoreProvider(applicationContext)
                val storageProvider = AndroidStorageProvider(applicationContext)
                VaultStore.getInstance(keystoreProvider, storageProvider)
            }

            setContentView(R.layout.activity_loading)

            // Skip the unlock prompt if the vault is already unlocked.
            if (vaultStore.isVaultUnlocked()) {
                onVaultUnlocked()
                return
            }

            unlockCoordinator = UnlockCoordinator(
                activity = this,
                vaultStore = vaultStore,
                onUnlocked = { onVaultUnlocked() },
                onCancelled = { cancelAndFinish() },
                onError = { message -> showError(message) },
            )
            unlockCoordinator.startUnlockFlow()
        } catch (e: Exception) {
            Log.e(TAG, "Error in onCreate", e)
            if (findViewById<View>(R.id.errorContainer) == null) {
                setContentView(R.layout.activity_loading)
            }
            showError("An error occurred: ${e.message}", buildErrorDetail(e))
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            UnlockCoordinator.REQUEST_CODE_PIN_UNLOCK ->
                unlockCoordinator.handlePinUnlockResult(resultCode, data)
            UnlockCoordinator.REQUEST_CODE_PASSWORD_UNLOCK ->
                unlockCoordinator.handlePasswordUnlockResult(resultCode, data)
        }
    }

    /**
     * Build the post-unlock FillResponse on a background thread and finish the
     * activity with the result expected by the Autofill framework.
     */
    private fun onVaultUnlocked() {
        lifecycleScope.launch {
            try {
                val response = withContext(Dispatchers.IO) { buildFillResponse() }
                val result = Intent().apply {
                    putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, response)
                }
                setResult(RESULT_OK, result)
                finish()
            } catch (e: Exception) {
                Log.e(TAG, "Error building post-unlock fill response", e)
                showError("Failed to load credentials", buildErrorDetail(e))
            }
        }
    }

    private fun buildFillResponse(): FillResponse {
        val allItems = vaultStore.getAllItems()

        val filteredByApp = appInfo?.let {
            RustItemMatcher.filterItemsByAppInfo(allItems, it)
        } ?: allItems

        val matchingItems = filteredByApp.filter { item ->
            val hasIdentifier = !item.username.isNullOrEmpty() || !item.email.isNullOrEmpty()
            val hasPassword = !item.password.isNullOrEmpty()
            hasIdentifier && hasPassword
        }

        Log.d(
            TAG,
            "Post-unlock items: app matches=${filteredByApp.size}, with data=${matchingItems.size}",
        )

        val copyTotpOnFill = getSharedPreferences("AliasVaultPrefs", MODE_PRIVATE)
            .getBoolean("autofill_copy_totp_on_fill", true)

        val responseBuilder = FillResponse.Builder()
        if (matchingItems.isEmpty()) {
            responseBuilder.addDataset(
                AutofillDatasetBuilder.createNoMatchesDataset(this, fields, appInfo),
            )
        } else {
            for (item in matchingItems) {
                responseBuilder.addDataset(
                    AutofillDatasetBuilder.createItemDataset(
                        context = this,
                        fields = fields,
                        item = item,
                        copyTotpOnSelect = copyTotpOnFill && item.hasTotp,
                    ),
                )
            }
        }
        return responseBuilder.build()
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

    private fun cancelAndFinish() {
        setResult(RESULT_CANCELED)
        finish()
    }

    /**
     * Show an inline error with a Close button, optionally exposing a collapsed
     * "Show details" toggle with the copy-pasteable [detail]. Delegates to the
     * shared [ErrorScreenView] used by the other native error screens.
     */
    private fun showError(message: String, detail: String? = null) {
        ErrorScreenView.show(this, message, detail) { cancelAndFinish() }
    }

    /**
     * Build the diagnostic detail for a failure, adding the autofill-specific
     * context (target app and detected field count) to the shared device/app
     * info and stack trace.
     */
    private fun buildErrorDetail(e: Throwable): String {
        val extra = "App: ${appInfo ?: "unknown"}, fields=${if (::fields.isInitialized) fields.size else 0}"
        return ErrorScreenView.buildDiagnosticDetail(this, e, extra)
    }
}
