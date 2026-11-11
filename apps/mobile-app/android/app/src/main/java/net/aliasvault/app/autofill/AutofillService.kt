/**
 * AliasVault Autofill Service Implementation
 *
 * This service implements the Android Autofill framework to provide AliasVault items
 * to forms. It identifies username and password fields in apps and websites,
 * then offers stored items from AliasVault.
 *
 */
package net.aliasvault.app.autofill

import android.app.PendingIntent
import android.content.Intent
import android.graphics.Typeface
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.text.SpannableString
import android.text.style.StyleSpan
import android.util.Log
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import net.aliasvault.app.R
import net.aliasvault.app.autofill.utils.AutofillDatasetBuilder
import net.aliasvault.app.autofill.utils.FieldFinder
import net.aliasvault.app.autofill.utils.InlinePresentationHelper
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.interfaces.ItemOperationCallback
import net.aliasvault.app.vaultstore.models.Item

/**
 * The AutofillService class.
 */
class AutofillService : AutofillService() {
    companion object {
        /**
         * The tag for logging.
         */
        private const val TAG = "AliasVaultAutofill"
    }

    override fun onFillRequest(
        request: FillRequest,
        cancellationSignal: CancellationSignal,
        callback: FillCallback,
    ) {
        var callbackCalled = false

        fun safeCallback(response: FillResponse? = null) {
            if (!callbackCalled) {
                callbackCalled = true
                callback.onSuccess(response)
            }
        }

        try {
            // Check if request was cancelled
            if (cancellationSignal.isCanceled) {
                return
            }

            // Find any autofillable fields in the form, across every fill context of this session
            val fieldFinder = FieldFinder(request.fillContexts.map { it.structure }, this)
            fieldFinder.parseStructure()

            // If no password field was found, return an empty response
            if (!fieldFinder.foundPasswordField && !fieldFinder.foundUsernameField) {
                Log.d(TAG, "No password or username field found, skipping autofill")
                safeCallback()
                return
            }
            val inlinePool = buildInlinePool(request)
            launchActivityForAutofill(fieldFinder, inlinePool) { response -> safeCallback(response) }
        } catch (e: Exception) {
            Log.e(TAG, "Unexpected error in onFillRequest", e)
            // Provide a simple fallback response to prevent white flash
            try {
                // Get the app/website information to include in debug dataset
                val fieldFinder = FieldFinder(request.fillContexts.map { it.structure }, this)
                fieldFinder.parseStructure()

                val responseBuilder = FillResponse.Builder()

                // Add debug dataset if enabled in settings
                val sharedPreferences = getSharedPreferences("AliasVaultPrefs", android.content.Context.MODE_PRIVATE)
                val showSearchText = sharedPreferences.getBoolean("autofill_show_search_text", false)
                val fallbackPool = buildInlinePool(request)
                addDatasets(responseBuilder, fieldFinder, fallbackPool, showSearchText) {
                    // Add failed to retrieve dataset
                    responseBuilder.addDataset(createFailedToRetrieveDataset(fieldFinder, fallbackPool))
                }

                safeCallback(responseBuilder.build())
            } catch (fallbackError: Exception) {
                Log.e(TAG, "Error creating fallback response", fallbackError)
                safeCallback()
            }
        }
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        // In a full implementation, you would:
        // 1. Extract the username/password from the SaveRequest
        // 2. Launch an activity to let the user confirm saving
        // 3. Save the item using the VaultStore

        // For now, just acknowledge the request
        callback.onSuccess()
    }

    private fun launchActivityForAutofill(
        fieldFinder: FieldFinder,
        inlinePool: InlinePresentationHelper.SpecPool,
        callback: (FillResponse?) -> Unit,
    ) {
        // Get the app/website information from assist structure.
        val appInfo = fieldFinder.appInfo

        // Ignore requests from our own unlock page as this would cause a loop
        if (appInfo == "net.aliasvault.app") {
            callback(null)
            return
        }

        // First try to get an existing instance
        val store = VaultStore.getExistingInstance()

        if (store != null) {
            // We have an existing instance, try to get items
            if (store.tryGetAllItems(object : ItemOperationCallback {
                    override fun onSuccess(result: List<Item>) {
                        try {
                            if (result.isEmpty()) {
                                // No items available
                                Log.d(TAG, "No items available")
                                callback(null)
                                return
                            }

                            val logins = AutofillDatasetBuilder.findLogins(result, appInfo, fieldFinder.unverifiedPage)
                            val responseBuilder = FillResponse.Builder()

                            // Add debug dataset if enabled in settings
                            val sharedPreferences = getSharedPreferences("AliasVaultPrefs", android.content.Context.MODE_PRIVATE)
                            val showSearchText = sharedPreferences.getBoolean("autofill_show_search_text", false)
                            addDatasets(responseBuilder, fieldFinder, inlinePool, showSearchText) {
                                if (logins.count == 0) {
                                    Log.d(TAG, "No items found for this app, showing 'no matches' option")
                                    responseBuilder.addDataset(
                                        AutofillDatasetBuilder.createNoMatchesDataset(
                                            this@AutofillService,
                                            fieldFinder.autofillableFields,
                                            fieldFinder.openAppTarget,
                                            inlinePool.next(),
                                        ),
                                    )
                                } else {
                                    AutofillDatasetBuilder.createLoginDatasets(this@AutofillService, fieldFinder.autofillableFields, logins, inlinePool::next)
                                        .forEach(responseBuilder::addDataset)

                                    // Add "Open app" option at the bottom when search text is not shown
                                    if (!showSearchText) {
                                        responseBuilder.addDataset(createOpenAppDataset(fieldFinder, inlinePool))
                                    }
                                }
                            }

                            callback(responseBuilder.build())
                        } catch (e: Exception) {
                            Log.e(TAG, "Error parsing items", e)
                            // Show "Failed to retrieve, open app" option instead of failing
                            val responseBuilder = FillResponse.Builder()
                            val sharedPreferences = getSharedPreferences("AliasVaultPrefs", android.content.Context.MODE_PRIVATE)
                            val showSearchText = sharedPreferences.getBoolean("autofill_show_search_text", false)
                            addDatasets(responseBuilder, fieldFinder, inlinePool, showSearchText) {
                                responseBuilder.addDataset(createFailedToRetrieveDataset(fieldFinder, inlinePool))
                            }
                            callback(responseBuilder.build())
                        }
                    }

                    override fun onError(e: Exception) {
                        Log.e(TAG, "Error getting items", e)
                        // Show "Failed to retrieve, open app" option instead of failing
                        val responseBuilder = FillResponse.Builder()
                        val sharedPreferences = getSharedPreferences("AliasVaultPrefs", android.content.Context.MODE_PRIVATE)
                        val showSearchText = sharedPreferences.getBoolean("autofill_show_search_text", false)
                        addDatasets(responseBuilder, fieldFinder, inlinePool, showSearchText) {
                            responseBuilder.addDataset(createFailedToRetrieveDataset(fieldFinder, inlinePool))
                        }
                        callback(responseBuilder.build())
                    }
                })
            ) {
                // Successfully used cached key - method returns true
                return
            }
        }

        Log.d(TAG, "Vault is locked, requiring authentication before fill")
        callback(AutofillDatasetBuilder.createVaultLockedResponse(this, fieldFinder.autofillableFields, appInfo, fieldFinder.unverifiedPage, inlinePool.next()))
    }

    /**
     * Creates inline suggestion pool, showing password suggestions in supported keyboards.
     */
    private fun buildInlinePool(request: FillRequest): InlinePresentationHelper.SpecPool {
        val inlineRequest = request.inlineSuggestionsRequest
            ?: return InlinePresentationHelper.SpecPool(emptyList(), 0)
        return InlinePresentationHelper.SpecPool(
            specs = inlineRequest.inlinePresentationSpecs,
            maxCount = inlineRequest.maxSuggestionCount,
        )
    }

    /**
     * Create a dataset for the "failed to retrieve" option.
     * @param fieldFinder The field finder
     * @param inlinePool Keyboard chip slots. If a slot is still free, this row
     *   also shows as an inline suggestion in the IME; otherwise it appears
     *   in the dropdown only.
     * @return The dataset
     */
    private fun createFailedToRetrieveDataset(
        fieldFinder: FieldFinder,
        inlinePool: InlinePresentationHelper.SpecPool,
    ): Dataset {
        // Create presentation for the "failed to retrieve" option
        val label = getString(R.string.autofill_failed_to_retrieve)
        val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item_logo)
        presentation.setTextViewText(R.id.text, label)

        val dataSetBuilder = Dataset.Builder(presentation)
        addInlineIfAvailable(dataSetBuilder, inlinePool, label)

        // Create deep link URL
        val deepLinkUrl = "aliasvault://reinitialize"

        // Add a click listener to open AliasVault app with deep link
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = android.net.Uri.parse(deepLinkUrl)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pendingIntent = PendingIntent.getActivity(
            this@AutofillService,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        dataSetBuilder.setAuthentication(pendingIntent.intentSender)

        // Add a placeholder value to both username and password fields to satisfy the requirement that at least one value must be set
        if (fieldFinder.autofillableFields.isNotEmpty()) {
            for (field in fieldFinder.autofillableFields) {
                dataSetBuilder.setValue(field.first, AutofillValue.forText(""))
            }
        }

        return dataSetBuilder.build()
    }

    /**
     * Create a debug dataset showing what string we're searching for, clickable to open the app.
     * @param fieldFinder The field finder
     * @param searchText The text being searched for
     * @param inlinePool Keyboard chip slots. If a slot is still free, this row
     *   also shows as an inline suggestion in the IME; otherwise it appears
     *   in the dropdown only.
     * @return The dataset
     */
    private fun createSearchDebugDataset(
        fieldFinder: FieldFinder,
        searchText: String,
        inlinePool: InlinePresentationHelper.SpecPool,
    ): Dataset {
        // Create presentation for the debug option (with search icon)
        val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item_icon)

        // Create bold text for the search string
        val boldText = SpannableString(searchText)
        boldText.setSpan(StyleSpan(Typeface.BOLD), 0, searchText.length, 0)

        presentation.setTextViewText(R.id.text, boldText)
        presentation.setImageViewResource(R.id.icon, R.drawable.ic_search)

        val dataSetBuilder = Dataset.Builder(presentation)
        addInlineIfAvailable(dataSetBuilder, inlinePool, searchText)

        // Get the app/website information to use as item URL
        val encodedUrl = fieldFinder.openAppTarget?.let { java.net.URLEncoder.encode(it, "UTF-8") } ?: ""

        // Create deep link URL to items page with item URL
        val deepLinkUrl = "aliasvault://items?itemUrl=$encodedUrl"

        // Add a click listener to open AliasVault app with deep link
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = android.net.Uri.parse(deepLinkUrl)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pendingIntent = PendingIntent.getActivity(
            this@AutofillService,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        dataSetBuilder.setAuthentication(pendingIntent.intentSender)

        // Add placeholder values to satisfy Android's requirement that at least one value must be set
        if (fieldFinder.autofillableFields.isNotEmpty()) {
            for (field in fieldFinder.autofillableFields) {
                dataSetBuilder.setValue(field.first, AutofillValue.forText(""))
            }
        }

        return dataSetBuilder.build()
    }

    /**
     * Create a dataset for the "open app" option.
     * @param fieldFinder The field finder
     * @param inlinePool Keyboard chip slots. If a slot is still free, this row
     *   also shows as an inline suggestion in the IME; otherwise it appears
     *   in the dropdown only.
     * @return The dataset
     */
    private fun createOpenAppDataset(
        fieldFinder: FieldFinder,
        inlinePool: InlinePresentationHelper.SpecPool,
    ): Dataset {
        // Create presentation for the "open app" option with AliasVault logo
        val label = getString(R.string.autofill_open_app)
        val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item_logo)
        presentation.setTextViewText(R.id.text, label)

        val dataSetBuilder = Dataset.Builder(presentation)
        addInlineIfAvailable(dataSetBuilder, inlinePool, label)

        // Open the action picker so the user can choose between linking this app
        // to an existing credential or creating a new one.
        val encodedUrl = fieldFinder.openAppTarget?.let { java.net.URLEncoder.encode(it, "UTF-8") } ?: ""
        val deepLinkUrl = "aliasvault://items/autofill-open-app?itemUrl=$encodedUrl"

        // Add a click listener to open AliasVault app with deep link
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = android.net.Uri.parse(deepLinkUrl)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pendingIntent = PendingIntent.getActivity(
            this@AutofillService,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        dataSetBuilder.setAuthentication(pendingIntent.intentSender)

        // Add placeholder values to satisfy Android's requirement that at least one value must be set
        if (fieldFinder.autofillableFields.isNotEmpty()) {
            for (field in fieldFinder.autofillableFields) {
                dataSetBuilder.setValue(field.first, AutofillValue.forText(""))
            }
        }

        return dataSetBuilder.build()
    }

    /**
     * Adds [addEntries] plus the search text row when enabled: first when rendered as a layover dropdown,
     * last when rendered as keyboard chips so actual matches stay visible.
     */
    private fun addDatasets(
        responseBuilder: FillResponse.Builder,
        fieldFinder: FieldFinder,
        inlinePool: InlinePresentationHelper.SpecPool,
        showSearchText: Boolean,
        addEntries: () -> Unit,
    ) {
        if (!showSearchText) {
            addEntries()
            return
        }

        val addSearchDebug = {
            val searchText = fieldFinder.appInfo ?: "unknown"
            responseBuilder.addDataset(createSearchDebugDataset(fieldFinder, searchText, inlinePool))
        }
        if (inlinePool.isInline) {
            addEntries()
            addSearchDebug()
        } else {
            addSearchDebug()
            addEntries()
        }
    }

    /**
     * Also render this row as an inline keyboard chip if the IME has a free
     * slot.
     */
    private fun addInlineIfAvailable(
        dataSetBuilder: Dataset.Builder,
        inlinePool: InlinePresentationHelper.SpecPool,
        label: String,
    ) {
        val spec = inlinePool.next() ?: return
        val inline = InlinePresentationHelper.buildActionPresentation(this, spec, label) ?: return
        dataSetBuilder.setInlinePresentation(inline)
    }
}
