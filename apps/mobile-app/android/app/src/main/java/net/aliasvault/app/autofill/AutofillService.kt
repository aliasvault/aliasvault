/**
 * AliasVault Autofill Service Implementation
 *
 * This service implements the Android Autofill framework to provide AliasVault credentials
 * to forms. It identifies username and password fields in apps and websites,
 * then offers stored credentials from AliasVault.
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
import net.aliasvault.app.MainActivity
import net.aliasvault.app.R
import net.aliasvault.app.autofill.models.FieldType
import net.aliasvault.app.autofill.utils.FieldFinder
import net.aliasvault.app.autofill.utils.ImageUtils
import net.aliasvault.app.autofill.utils.RustCredentialMatcher
import net.aliasvault.app.utils.ItemTypeIcon
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.interfaces.CredentialOperationCallback
import net.aliasvault.app.vaultstore.models.Credential

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

            // Get the autofill contexts for this request
            val contexts = request.fillContexts
            val context = contexts.last()
            val structure = context.structure

            // Find any autofillable fields in the form
            val fieldFinder = FieldFinder(structure)
            fieldFinder.parseStructure()

            // If no password field was found, return an empty response
            if (!fieldFinder.foundPasswordField && !fieldFinder.foundUsernameField) {
                Log.d(TAG, "No password or username field found, skipping autofill")
                safeCallback()
                return
            }
            launchActivityForAutofill(fieldFinder) { response -> safeCallback(response) }
        } catch (e: Exception) {
            Log.e(TAG, "Unexpected error in onFillRequest", e)
            // Provide a simple fallback response to prevent white flash
            try {
                // Get the app/website information to include in debug dataset
                val contexts = request.fillContexts
                val context = contexts.last()
                val structure = context.structure
                val fieldFinder = FieldFinder(structure)
                fieldFinder.parseStructure()
                val appInfo = fieldFinder.getAppInfo()

                val responseBuilder = FillResponse.Builder()

                // Add debug dataset if enabled in settings
                val sharedPreferences = getSharedPreferences("AliasVaultPrefs", android.content.Context.MODE_PRIVATE)
                val showSearchText = sharedPreferences.getBoolean("autofill_show_search_text", false)
                if (showSearchText) {
                    responseBuilder.addDataset(createSearchDebugDataset(fieldFinder, appInfo ?: "unknown"))
                }

                // Add failed to retrieve dataset
                responseBuilder.addDataset(createFailedToRetrieveDataset(fieldFinder))

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
        // 3. Save the credential using the VaultStore

        // For now, just acknowledge the request
        callback.onSuccess()
    }

    private fun launchActivityForAutofill(fieldFinder: FieldFinder, callback: (FillResponse?) -> Unit) {
        // Get the app/website information from assist structure.
        val appInfo = fieldFinder.getAppInfo()

        // Ignore requests from our own unlock page as this would cause a loop
        if (appInfo == "net.aliasvault.app") {
            callback(null)
            return
        }

        // First try to get an existing instance
        val store = VaultStore.getExistingInstance()

        if (store != null) {
            // We have an existing instance, try to get credentials
            if (store.tryGetAllCredentials(object : CredentialOperationCallback {
                    override fun onSuccess(result: List<Credential>) {
                        try {
                            if (result.isEmpty()) {
                                // No credentials available
                                Log.d(TAG, "No credentials available")
                                callback(null)
                                return
                            }

                            // Filter credentials based on app/website info
                            val filteredByApp = if (appInfo != null) {
                                RustCredentialMatcher.filterCredentialsByAppInfo(result, appInfo)
                            } else {
                                result
                            }

                            // Further filter to only include credentials with autofillable data.
                            // This prevents from showing non-autofillable credentials like passkeys.
                            val filteredCredentials = filteredByApp.filter { credential ->
                                val hasUsername = !credential.username.isNullOrEmpty()
                                val hasEmail = credential.alias?.email?.isNotEmpty() == true
                                val hasPassword = !credential.password?.value.isNullOrEmpty()

                                (hasUsername || hasEmail) && hasPassword
                            }

                            Log.d(
                                TAG,
                                "Credentials after filtering: app matches=${filteredByApp.size}, with data=${filteredCredentials.size}",
                            )

                            val responseBuilder = FillResponse.Builder()

                            // Add debug dataset if enabled in settings
                            val sharedPreferences = getSharedPreferences("AliasVaultPrefs", android.content.Context.MODE_PRIVATE)
                            val showSearchText = sharedPreferences.getBoolean("autofill_show_search_text", false)
                            if (showSearchText) {
                                responseBuilder.addDataset(createSearchDebugDataset(fieldFinder, appInfo ?: "unknown"))
                            }

                            // If there are no results, return "no matches" placeholder option.
                            if (filteredCredentials.isEmpty()) {
                                Log.d(
                                    TAG,
                                    "No credentials found for this app, showing 'no matches' option",
                                )
                                responseBuilder.addDataset(createNoMatchesDataset(fieldFinder))
                            } else {
                                // If there are matches, add them to the dataset
                                for (credential in filteredCredentials) {
                                    responseBuilder.addDataset(
                                        createCredentialDataset(fieldFinder, credential),
                                    )
                                }

                                // Add "Open app" option at the bottom (when search text is not shown and there are matches)
                                if (!showSearchText) {
                                    responseBuilder.addDataset(createOpenAppDataset(fieldFinder))
                                }
                            }

                            callback(responseBuilder.build())
                        } catch (e: Exception) {
                            Log.e(TAG, "Error parsing credentials", e)
                            // Show "Failed to retrieve, open app" option instead of failing
                            val responseBuilder = FillResponse.Builder()
                            val sharedPreferences = getSharedPreferences("AliasVaultPrefs", android.content.Context.MODE_PRIVATE)
                            val showSearchText = sharedPreferences.getBoolean("autofill_show_search_text", false)
                            if (showSearchText) {
                                responseBuilder.addDataset(createSearchDebugDataset(fieldFinder, appInfo ?: "unknown"))
                            }
                            responseBuilder.addDataset(createFailedToRetrieveDataset(fieldFinder))
                            callback(responseBuilder.build())
                        }
                    }

                    override fun onError(e: Exception) {
                        Log.e(TAG, "Error getting credentials", e)
                        // Show "Failed to retrieve, open app" option instead of failing
                        val responseBuilder = FillResponse.Builder()
                        val sharedPreferences = getSharedPreferences("AliasVaultPrefs", android.content.Context.MODE_PRIVATE)
                        val showSearchText = sharedPreferences.getBoolean("autofill_show_search_text", false)
                        if (showSearchText) {
                            responseBuilder.addDataset(createSearchDebugDataset(fieldFinder, appInfo ?: "unknown"))
                        }
                        responseBuilder.addDataset(createFailedToRetrieveDataset(fieldFinder))
                        callback(responseBuilder.build())
                    }
                })
            ) {
                // Successfully used cached key - method returns true
                return
            }
        }

        // If we get here, either there was no instance or the vault wasn't unlocked
        // Show a "vault locked" placeholder instead of launching the activity
        Log.d(TAG, "Vault is locked, showing placeholder")

        val responseBuilder = FillResponse.Builder()
        responseBuilder.addDataset(createVaultLockedDataset(fieldFinder))
        callback(responseBuilder.build())
    }

    /**
     * Create a dataset from a credential.
     * @param fieldFinder The field finder
     * @param credential The credential
     * @return The dataset
     */
    private fun createCredentialDataset(fieldFinder: FieldFinder, credential: Credential): Dataset {
        // Always use icon layout (will show logo or placeholder icon)
        val layoutId = R.layout.autofill_dataset_item_icon

        // Create presentation for this credential using our custom layout
        val presentation = RemoteViews(packageName, layoutId)

        val dataSetBuilder = Dataset.Builder(presentation)

        // Add autofill values for all fields
        var presentationDisplayValue = credential.service.name
        var hasSetValue = false
        for (field in fieldFinder.autofillableFields) {
            val fieldType = field.second
            when (fieldType) {
                FieldType.PASSWORD -> {
                    if (credential.password != null) {
                        dataSetBuilder.setValue(
                            field.first,
                            AutofillValue.forText(credential.password.value as CharSequence),
                        )
                        hasSetValue = true
                    }
                }
                FieldType.EMAIL -> {
                    if (credential.alias?.email != null && credential.alias.email.isNotEmpty()) {
                        dataSetBuilder.setValue(
                            field.first,
                            AutofillValue.forText(credential.alias.email),
                        )
                        hasSetValue = true
                        if (credential.alias.email.isNotEmpty()) {
                            presentationDisplayValue += " (${credential.alias.email})"
                        } else if (!credential.username.isNullOrEmpty()) {
                            presentationDisplayValue += " (${credential.username})"
                        }
                    } else if (!credential.username.isNullOrEmpty()) {
                        dataSetBuilder.setValue(
                            field.first,
                            AutofillValue.forText(credential.username),
                        )
                        hasSetValue = true
                        if (credential.username.isNotEmpty()) {
                            presentationDisplayValue += " (${credential.username})"
                        } else if ((credential.alias?.email ?: "").isNotEmpty()) {
                            presentationDisplayValue += " (${credential.alias?.email})"
                        }
                    }
                }
                FieldType.USERNAME -> {
                    if (!credential.username.isNullOrEmpty()) {
                        dataSetBuilder.setValue(
                            field.first,
                            AutofillValue.forText(credential.username),
                        )
                        hasSetValue = true
                        if (credential.username.isNotEmpty()) {
                            presentationDisplayValue += " (${credential.username})"
                        } else if ((credential.alias?.email ?: "").isNotEmpty()) {
                            presentationDisplayValue += " (${credential.alias?.email})"
                        }
                    } else if (credential.alias?.email != null && credential.alias.email.isNotEmpty()) {
                        dataSetBuilder.setValue(
                            field.first,
                            AutofillValue.forText(credential.alias.email),
                        )
                        hasSetValue = true
                        if (credential.alias.email.isNotEmpty()) {
                            presentationDisplayValue += " (${credential.alias?.email})"
                        }
                    }
                }
                else -> {
                    // For unknown field types, try both email and username
                    if (credential.alias?.email != null && credential.alias.email.isNotEmpty()) {
                        dataSetBuilder.setValue(
                            field.first,
                            AutofillValue.forText(credential.alias.email),
                        )
                        hasSetValue = true
                        if (credential.alias.email.isNotEmpty()) {
                            presentationDisplayValue += " (${credential.alias.email})"
                        }
                    } else if (!credential.username.isNullOrEmpty()) {
                        dataSetBuilder.setValue(
                            field.first,
                            AutofillValue.forText(credential.username),
                        )
                        hasSetValue = true
                        if (credential.username.isNotEmpty()) {
                            presentationDisplayValue += " (${credential.username})"
                        }
                    }
                }
            }
        }

        // If no value was set, this shouldn't happen now since we filter credentials
        // but keep as safety measure
        if (!hasSetValue && fieldFinder.autofillableFields.isNotEmpty()) {
            Log.w(TAG, "Credential ${credential.service.name} has no autofillable data - this should have been filtered")
            dataSetBuilder.setValue(
                fieldFinder.autofillableFields.first().first,
                AutofillValue.forText(""),
            )
        }

        // Set the display value of the dropdown item.
        presentation.setTextViewText(
            R.id.text,
            presentationDisplayValue,
        )

        // Set the logo if available, otherwise use placeholder icon
        val logoBytes = credential.service.logo
        val bitmap = if (logoBytes != null) {
            ImageUtils.bytesToBitmap(logoBytes)
        } else {
            // Use placeholder key icon for Login/Alias items
            ItemTypeIcon.getIcon(
                context = this@AutofillService,
                itemType = ItemTypeIcon.ItemType.LOGIN,
                size = 96,
            )
        }

        if (bitmap != null) {
            presentation.setImageViewBitmap(R.id.icon, bitmap)
        }

        return dataSetBuilder.build()
    }

    /**
     * Create a dataset for the "no matches" option.
     * @param fieldFinder The field finder
     * @return The dataset
     */
    private fun createNoMatchesDataset(fieldFinder: FieldFinder): Dataset {
        // Create presentation for the "no matches" option
        val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item_logo)
        presentation.setTextViewText(
            R.id.text,
            getString(R.string.autofill_no_match_found),
        )

        val dataSetBuilder = Dataset.Builder(presentation)

        // Get the app/website information to use as service URL
        val appInfo = fieldFinder.getAppInfo()
        val encodedUrl = appInfo?.let { java.net.URLEncoder.encode(it, "UTF-8") } ?: ""

        // Create deep link URL
        val deepLinkUrl = "aliasvault://credentials/add-edit-page?serviceUrl=$encodedUrl"

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
     * Create a dataset for the "vault locked" option.
     * @param fieldFinder The field finder
     * @return The dataset
     */
    private fun createVaultLockedDataset(fieldFinder: FieldFinder): Dataset {
        // Create presentation for the "vault locked" option
        val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item_logo)
        presentation.setTextViewText(
            R.id.text,
            getString(R.string.autofill_vault_locked),
        )

        val dataSetBuilder = Dataset.Builder(presentation)

        // Add a click listener to open AliasVault app
        val intent = Intent(this@AutofillService, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            putExtra("OPEN_CREDENTIALS", true)
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
     * Create a dataset for the "failed to retrieve" option.
     * @param fieldFinder The field finder
     * @return The dataset
     */
    private fun createFailedToRetrieveDataset(fieldFinder: FieldFinder): Dataset {
        // Create presentation for the "failed to retrieve" option
        val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item_logo)
        presentation.setTextViewText(
            R.id.text,
            getString(R.string.autofill_failed_to_retrieve),
        )

        val dataSetBuilder = Dataset.Builder(presentation)

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
     * @return The dataset
     */
    private fun createSearchDebugDataset(fieldFinder: FieldFinder, searchText: String): Dataset {
        // Create presentation for the debug option (with search icon)
        val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item_icon)

        // Create bold text for the search string
        val boldText = SpannableString(searchText)
        boldText.setSpan(StyleSpan(Typeface.BOLD), 0, searchText.length, 0)

        presentation.setTextViewText(R.id.text, boldText)
        presentation.setImageViewResource(R.id.icon, R.drawable.ic_search)

        val dataSetBuilder = Dataset.Builder(presentation)

        // Get the app/website information to use as service URL
        val appInfo = fieldFinder.getAppInfo()
        val encodedUrl = appInfo?.let { java.net.URLEncoder.encode(it, "UTF-8") } ?: ""

        // Create deep link URL to credentials page with service URL
        val deepLinkUrl = "aliasvault://credentials?serviceUrl=$encodedUrl"

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
     * @return The dataset
     */
    private fun createOpenAppDataset(fieldFinder: FieldFinder): Dataset {
        // Create presentation for the "open app" option with AliasVault logo
        val presentation = RemoteViews(packageName, R.layout.autofill_dataset_item_logo)
        presentation.setTextViewText(
            R.id.text,
            getString(R.string.autofill_open_app),
        )

        val dataSetBuilder = Dataset.Builder(presentation)

        // Create deep link URL to open the credentials page
        val appInfo = fieldFinder.getAppInfo()
        val encodedUrl = appInfo?.let { java.net.URLEncoder.encode(it, "UTF-8") } ?: ""
        val deepLinkUrl = "aliasvault://credentials?serviceUrl=$encodedUrl"

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
}
