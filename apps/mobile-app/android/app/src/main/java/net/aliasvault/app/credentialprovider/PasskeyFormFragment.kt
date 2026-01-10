package net.aliasvault.app.credentialprovider

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.provider.PendingIntentHandler
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.aliasvault.app.R
import net.aliasvault.app.components.LoadingIndicator
import net.aliasvault.app.credentialprovider.models.PasskeyRegistrationViewModel
import net.aliasvault.app.exceptions.PasskeyOperationException
import net.aliasvault.app.exceptions.VaultOperationException
import net.aliasvault.app.utils.Helpers
import net.aliasvault.app.vaultstore.PasskeyWithCredentialInfo
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.models.Passkey
import net.aliasvault.app.vaultstore.passkey.PasskeyAuthenticator
import net.aliasvault.app.vaultstore.passkey.PasskeyHelper
import net.aliasvault.app.webapi.WebApiService
import org.json.JSONObject
import java.util.Date
import java.util.UUID

/**
 * Fragment for passkey creation/replacement form.
 */
class PasskeyFormFragment : Fragment() {

    companion object {
        private const val TAG = "PasskeyFormFragment"
        private const val ARG_IS_REPLACE = "is_replace"
        private const val ARG_PASSKEY_ID = "passkey_id"

        /**
         * Create a new instance of PasskeyFormFragment.
         */
        fun newInstance(isReplace: Boolean, passkeyId: String?): PasskeyFormFragment {
            return PasskeyFormFragment().apply {
                arguments = Bundle().apply {
                    putBoolean(ARG_IS_REPLACE, isReplace)
                    passkeyId?.let { putString(ARG_PASSKEY_ID, it) }
                }
            }
        }
    }

    private val viewModel: PasskeyRegistrationViewModel by activityViewModels()
    private lateinit var vaultStore: VaultStore
    private lateinit var webApiService: WebApiService

    private var isReplace: Boolean = false
    private var passkeyToReplace: PasskeyWithCredentialInfo? = null

    // UI elements
    private lateinit var headerSubtitle: TextView
    private lateinit var infoExplanationText: TextView
    private lateinit var displayNameInput: TextInputEditText
    private lateinit var websiteText: TextView
    private lateinit var usernameContainer: View
    private lateinit var usernameText: TextView
    private lateinit var errorText: TextView
    private lateinit var saveButton: MaterialButton
    private lateinit var cancelButton: MaterialButton
    private lateinit var scrollView: View
    private lateinit var loadingOverlay: View
    private lateinit var loadingIndicator: LoadingIndicator

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        isReplace = arguments?.getBoolean(ARG_IS_REPLACE) ?: false
        val passkeyId = arguments?.getString(ARG_PASSKEY_ID)
        passkeyToReplace = passkeyId?.let {
            viewModel.getPasskeyById(UUID.fromString(it))
        }

        // Initialize services
        vaultStore = VaultStore.getExistingInstance()
            ?: throw VaultOperationException("VaultStore not initialized")
        webApiService = WebApiService(requireContext())
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View? {
        return inflater.inflate(R.layout.fragment_passkey_form, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        // Initialize UI elements
        val headerTitle = view.findViewById<TextView>(R.id.headerTitle)
        headerSubtitle = view.findViewById(R.id.headerSubtitle)
        infoExplanationText = view.findViewById(R.id.infoExplanationText)
        displayNameInput = view.findViewById(R.id.displayNameInput)
        websiteText = view.findViewById(R.id.websiteText)
        usernameContainer = view.findViewById(R.id.usernameContainer)
        usernameText = view.findViewById(R.id.usernameText)
        errorText = view.findViewById(R.id.errorText)
        saveButton = view.findViewById(R.id.saveButton)
        cancelButton = view.findViewById(R.id.cancelButton)
        scrollView = view.findViewById(R.id.scrollView)
        loadingOverlay = view.findViewById(R.id.loadingOverlay)
        loadingIndicator = view.findViewById(R.id.loadingIndicator)

        // Update UI based on mode
        if (isReplace && passkeyToReplace != null) {
            headerTitle.text = getString(R.string.replace_passkey_title)
            headerSubtitle.visibility = View.GONE
            infoExplanationText.text = getString(R.string.passkey_replace_explanation)
            displayNameInput.setText(passkeyToReplace?.passkey?.displayName)
            saveButton.text = getString(R.string.passkey_replace_button)
        } else {
            headerTitle.text = getString(R.string.create_passkey_title)
            headerSubtitle.visibility = View.GONE
            infoExplanationText.text = getString(R.string.passkey_create_explanation)
            displayNameInput.setText(viewModel.rpName ?: viewModel.rpId)
            saveButton.text = getString(R.string.passkey_create_button)
        }

        // Set website
        websiteText.text = viewModel.rpId

        // Set username if available
        if (!viewModel.userName.isNullOrEmpty()) {
            usernameContainer.visibility = View.VISIBLE
            usernameText.text = viewModel.userName
        } else {
            usernameContainer.visibility = View.GONE
        }

        // Set up button listeners
        saveButton.setOnClickListener {
            onSaveClicked()
        }

        cancelButton.setOnClickListener {
            if (viewModel.existingPasskeys.isNotEmpty()) {
                // Go back to selection view
                parentFragmentManager.popBackStack()
            } else {
                requireActivity().setResult(Activity.RESULT_CANCELED)
                requireActivity().finish()
            }
        }
    }

    private fun onSaveClicked() {
        // Validate display name
        val displayName = displayNameInput.text.toString().trim()
        if (displayName.isEmpty()) {
            errorText.text = getString(R.string.passkey_error_empty_name)
            errorText.visibility = View.VISIBLE
            return
        }

        // Hide error and start creation
        errorText.visibility = View.GONE

        // Start passkey creation in coroutine
        lifecycleScope.launch {
            if (isReplace && passkeyToReplace != null) {
                replacePasskeyFlow(displayName, passkeyToReplace!!)
            } else {
                createPasskeyFlow(displayName)
            }
        }
    }

    private fun showLoading(message: String) {
        loadingIndicator.setMessage(message)
        loadingIndicator.startAnimation()
        loadingOverlay.visibility = View.VISIBLE
        scrollView.alpha = 0.3f
        scrollView.isEnabled = false
    }

    private fun hideLoading() {
        loadingIndicator.stopAnimation()
        loadingOverlay.visibility = View.GONE
        scrollView.alpha = 1.0f
        scrollView.isEnabled = true
    }

    private fun showError(message: String) {
        hideLoading()
        errorText.text = message
        errorText.visibility = View.VISIBLE
    }

    /**
     * Create a new passkey flow.
     */
    private suspend fun createPasskeyFlow(displayName: String) = withContext(Dispatchers.IO) {
        try {
            // Step 1: Sync vault before creating passkey to ensure we have latest data
            withContext(Dispatchers.Main) {
                showLoading(getString(R.string.passkey_checking_connection))
            }

            val syncResult = vaultStore.syncVaultWithServer(webApiService)
            if (!syncResult.success && !syncResult.wasOffline) {
                // Server connectivity check failed - show appropriate error dialog
                withContext(Dispatchers.Main) {
                    showSyncErrorAlert(Exception(syncResult.error ?: "Sync failed"))
                }
                return@withContext
            }

            // Step 2: Create passkey credentials
            withContext(Dispatchers.Main) {
                showLoading(getString(R.string.passkey_creating))
            }

            // Try to extract favicon from the website URL if possible
            var logo: ByteArray? = null
            try {
                logo = webApiService.extractFavicon("https://${viewModel.rpId}")
            } catch (e: Exception) {
                Log.w(TAG, "Favicon extraction failed", e)
                // Continue without logo
            }

            // Generate passkey credentials
            val passkeyId = UUID.randomUUID()
            val credentialId = PasskeyHelper.guidToBytes(passkeyId.toString())

            // Parse request to get challenge (for building response clientDataJSON later)
            val requestObj = JSONObject(viewModel.requestJson)
            val challenge = requestObj.optString("challenge", "")

            // Use the origin set by PasskeyRegistrationActivity
            val requestOrigin = viewModel.origin
                ?: throw net.aliasvault.app.exceptions.PasskeyOperationException(
                    "Origin not available",
                )

            // Extract PRF inputs if present
            val prfInputs = extractPrfInputs(requestObj)
            val enablePrf = prfInputs != null

            // Create the passkey using PasskeyAuthenticator
            val passkeyResult = PasskeyAuthenticator.createPasskey(
                credentialId = credentialId,
                rpId = viewModel.rpId,
                userId = viewModel.userId,
                userName = viewModel.userName,
                userDisplayName = viewModel.userDisplayName,
                uvPerformed = true,
                enablePrf = enablePrf,
                prfInputs = prfInputs,
            )

            // Create Passkey model object
            val now = Date()
            val passkey = Passkey(
                id = passkeyId,
                parentItemId = UUID.randomUUID(), // Will be set by createItemWithPasskey
                rpId = viewModel.rpId,
                userHandle = viewModel.userId,
                userName = viewModel.userName,
                publicKey = passkeyResult.publicKey,
                privateKey = passkeyResult.privateKey,
                prfKey = passkeyResult.prfSecret,
                displayName = displayName,
                createdAt = now,
                updatedAt = now,
                isDeleted = false,
            )

            // Step 3: Store in database
            withContext(Dispatchers.Main) {
                showLoading(getString(R.string.passkey_saving))
            }

            vaultStore.createItemWithPasskey(
                rpId = viewModel.rpId,
                userName = viewModel.userName,
                displayName = displayName,
                passkeyObj = passkey,
                logo = logo,
            )

            // Step 4: Upload vault changes to server
            withContext(Dispatchers.Main) {
                showLoading(getString(R.string.passkey_syncing))
            }

            try {
                vaultStore.mutateVault(webApiService)
            } catch (e: Exception) {
                Log.w(TAG, "Vault mutation failed, but passkey was created locally", e)
                // Show error dialog but continue - passkey is still saved locally
                withContext(Dispatchers.Main) {
                    showSyncErrorAlert(e)
                    delay(2000)
                }
            }

            // Step 5: Update credential identity cache
            updateCredentialIdentityCache()

            // Build response
            val credentialIdB64 = Helpers.bytesToBase64url(credentialId)
            val attestationObjectB64 = Helpers.bytesToBase64url(passkeyResult.attestationObject)

            // Rebuild clientDataJSON for the response (needed for the credential response)
            val clientDataJson = buildClientDataJson(challenge, requestOrigin)
            val clientDataJsonB64 = Helpers.bytesToBase64url(clientDataJson.toByteArray(Charsets.UTF_8))

            val responseJson = JSONObject().apply {
                put("id", credentialIdB64)
                put("rawId", credentialIdB64)
                put("type", "public-key")
                put("authenticatorAttachment", "cross-platform")
                put(
                    "response",
                    JSONObject().apply {
                        put("clientDataJSON", clientDataJsonB64)
                        put("attestationObject", attestationObjectB64)
                        put("authenticatorData", Helpers.bytesToBase64url(passkeyResult.authenticatorData))
                        put(
                            "transports",
                            org.json.JSONArray().apply {
                                put("internal")
                            },
                        )
                        put("publicKey", Helpers.bytesToBase64url(passkeyResult.publicKeyDER))
                        put("publicKeyAlgorithm", -7)
                    },
                )

                // Add PRF extension results if present
                val prfResults = if (enablePrf) passkeyResult.prfResults else null
                if (prfResults != null) {
                    put(
                        "clientExtensionResults",
                        JSONObject().apply {
                            put(
                                "prf",
                                JSONObject().apply {
                                    put("enabled", true)
                                    put(
                                        "results",
                                        JSONObject().apply {
                                            put("first", Helpers.bytesToBase64url(prfResults.first))
                                            prfResults.second?.let {
                                                put("second", Helpers.bytesToBase64url(it))
                                            }
                                        },
                                    )
                                },
                            )
                        },
                    )
                } else {
                    put("clientExtensionResults", JSONObject())
                }
            }

            Log.d(TAG, "Response JSON: ${responseJson.toString(2)}")

            val response = CreatePublicKeyCredentialResponse(responseJson.toString())

            withContext(Dispatchers.Main) {
                hideLoading()
                val resultIntent = Intent()
                try {
                    PendingIntentHandler.setCreateCredentialResponse(resultIntent, response)
                    requireActivity().setResult(Activity.RESULT_OK, resultIntent)
                    requireActivity().finish()
                } catch (e: Exception) {
                    Log.e(TAG, "Error setting credential response", e)
                    showError(getString(R.string.passkey_creation_failed) + ": ${e.message}")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error creating passkey", e)
            withContext(Dispatchers.Main) {
                showError(getString(R.string.passkey_creation_failed) + ": ${e.message}")
            }
        }
    }

    /**
     * Replace an existing passkey flow.
     */
    private suspend fun replacePasskeyFlow(displayName: String, passkeyToReplace: PasskeyWithCredentialInfo) = withContext(Dispatchers.IO) {
        try {
            // Step 1: Sync vault before replacing passkey to ensure we have latest data
            withContext(Dispatchers.Main) {
                showLoading(getString(R.string.passkey_checking_connection))
            }

            val syncResult = vaultStore.syncVaultWithServer(webApiService)
            if (!syncResult.success && !syncResult.wasOffline) {
                // Server connectivity check failed - show appropriate error dialog
                withContext(Dispatchers.Main) {
                    showSyncErrorAlert(Exception(syncResult.error ?: "Sync failed"))
                }
                return@withContext
            }

            // Step 2: Replace passkey
            withContext(Dispatchers.Main) {
                showLoading(getString(R.string.passkey_replacing))
            }

            // Extract favicon (optional)
            var logo: ByteArray? = null
            try {
                logo = webApiService.extractFavicon("https://${viewModel.rpId}")
            } catch (e: Exception) {
                Log.w(TAG, "Favicon extraction failed", e)
                // Continue without logo
            }

            // Generate new passkey credentials
            val newPasskeyId = UUID.randomUUID()
            val credentialId = PasskeyHelper.guidToBytes(newPasskeyId.toString())

            // Parse request to get challenge
            val requestObj = JSONObject(viewModel.requestJson)
            val challenge = requestObj.optString("challenge", "")

            // Use the origin set by PasskeyRegistrationActivity
            val requestOrigin = viewModel.origin
                ?: throw PasskeyOperationException("Origin not available")

            // Extract PRF inputs if present
            val prfInputs = extractPrfInputs(requestObj)
            val enablePrf = prfInputs != null

            // Create the new passkey using PasskeyAuthenticator
            val passkeyResult = PasskeyAuthenticator.createPasskey(
                credentialId = credentialId,
                rpId = viewModel.rpId,
                userId = viewModel.userId,
                userName = viewModel.userName,
                userDisplayName = viewModel.userDisplayName,
                uvPerformed = true,
                enablePrf = enablePrf,
                prfInputs = prfInputs,
            )

            // Create new Passkey model object
            val now = Date()
            val newPasskey = Passkey(
                id = newPasskeyId,
                parentItemId = passkeyToReplace.passkey.parentItemId,
                rpId = viewModel.rpId,
                userHandle = viewModel.userId,
                userName = viewModel.userName,
                publicKey = passkeyResult.publicKey,
                privateKey = passkeyResult.privateKey,
                prfKey = passkeyResult.prfSecret,
                displayName = displayName,
                createdAt = now,
                updatedAt = now,
                isDeleted = false,
            )

            // Step 3: Replace in database
            withContext(Dispatchers.Main) {
                showLoading(getString(R.string.passkey_saving))
            }

            val db = vaultStore.database ?: throw VaultOperationException("Vault not unlocked")
            db.beginTransaction()
            try {
                vaultStore.replacePasskey(
                    oldPasskeyId = passkeyToReplace.passkey.id,
                    newPasskey = newPasskey,
                    displayName = displayName,
                    logo = logo,
                )

                // Commit transaction and persist to encrypted vault file
                vaultStore.commitTransaction()
            } catch (e: Exception) {
                db.endTransaction()
                throw e
            }

            // Step 4: Upload vault changes to server
            withContext(Dispatchers.Main) {
                showLoading(getString(R.string.passkey_syncing))
            }

            try {
                vaultStore.mutateVault(webApiService)
            } catch (e: Exception) {
                Log.w(TAG, "Vault mutation failed, but passkey was replaced locally", e)
                // Show error dialog but continue - passkey is still saved locally
                withContext(Dispatchers.Main) {
                    showSyncErrorAlert(e)
                    delay(2000)
                }
            }

            // Step 5: Update credential identity cache
            updateCredentialIdentityCache()

            // Build response (same as create flow)
            val credentialIdB64 = Helpers.bytesToBase64url(credentialId)
            val attestationObjectB64 = Helpers.bytesToBase64url(passkeyResult.attestationObject)

            val clientDataJson = buildClientDataJson(challenge, requestOrigin)
            val clientDataJsonB64 = Helpers.bytesToBase64url(clientDataJson.toByteArray(Charsets.UTF_8))

            val responseJson = JSONObject().apply {
                put("id", credentialIdB64)
                put("rawId", credentialIdB64)
                put("type", "public-key")
                put("authenticatorAttachment", "cross-platform")
                put(
                    "response",
                    JSONObject().apply {
                        put("clientDataJSON", clientDataJsonB64)
                        put("attestationObject", attestationObjectB64)
                        put("authenticatorData", Helpers.bytesToBase64url(passkeyResult.authenticatorData))
                        put(
                            "transports",
                            org.json.JSONArray().apply {
                                put("internal")
                            },
                        )
                        put("publicKey", Helpers.bytesToBase64url(passkeyResult.publicKeyDER))
                        put("publicKeyAlgorithm", -7)
                    },
                )

                // Add PRF extension results if present
                val prfResults = if (enablePrf) {
                    passkeyResult.prfResults
                } else {
                    null
                }
                if (prfResults != null) {
                    put(
                        "clientExtensionResults",
                        JSONObject().apply {
                            put(
                                "prf",
                                JSONObject().apply {
                                    put("enabled", true)
                                    put(
                                        "results",
                                        JSONObject().apply {
                                            put("first", Helpers.bytesToBase64url(prfResults.first))
                                            prfResults.second?.let {
                                                put("second", Helpers.bytesToBase64url(it))
                                            }
                                        },
                                    )
                                },
                            )
                        },
                    )
                } else {
                    put("clientExtensionResults", JSONObject())
                }
            }

            val response = CreatePublicKeyCredentialResponse(responseJson.toString())

            withContext(Dispatchers.Main) {
                hideLoading()
                val resultIntent = Intent()
                try {
                    PendingIntentHandler.setCreateCredentialResponse(resultIntent, response)
                    requireActivity().setResult(Activity.RESULT_OK, resultIntent)
                    requireActivity().finish()
                } catch (e: Exception) {
                    Log.e(TAG, "Error setting credential response", e)
                    showError(getString(R.string.passkey_creation_failed) + ": ${e.message}")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error replacing passkey", e)
            withContext(Dispatchers.Main) {
                showError(getString(R.string.passkey_creation_failed) + ": ${e.message}")
            }
        }
    }

    /**
     * Extract PRF extension inputs from request.
     * Note: PRF needs to be fully tested, we did not get PRF eval in the request from CredMan so far.
     */
    private fun extractPrfInputs(requestObj: JSONObject): PasskeyAuthenticator.PrfInputs? {
        try {
            val extensions = requestObj.optJSONObject("extensions") ?: return null
            val prf = extensions.optJSONObject("prf") ?: return null
            val eval = prf.optJSONObject("eval") ?: return null

            val firstB64 = eval.optString("first")
            if (firstB64.isEmpty()) return null
            val secondB64 = eval.optString("second")

            val first = Helpers.base64urlDecode(firstB64)
            val second = if (secondB64.isNotEmpty()) {
                Helpers.base64urlDecode(secondB64)
            } else {
                null
            }

            return PasskeyAuthenticator.PrfInputs(first, second)
        } catch (e: Exception) {
            Log.w(TAG, "Error extracting PRF inputs", e)
            return null
        }
    }

    /**
     * Update credential identity cache after passkey creation/replacement.
     */
    private fun updateCredentialIdentityCache() {
        try {
            val identityStore = CredentialIdentityStore.getInstance(requireContext())
            identityStore.saveCredentialIdentities(vaultStore)
            Log.d(TAG, "Updated credential identity cache")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update credential identity cache", e)
            // Non-critical error, don't throw
        }
    }

    /**
     * Build clientDataJSON for WebAuthn create request.
     */
    private fun buildClientDataJson(challenge: String, origin: String): String {
        return """{"type":"webauthn.create","challenge":"$challenge","origin":"$origin","crossOrigin":false}"""
    }

    /**
     * Show sync error alert dialog with appropriate message based on error type.
     * This method mirrors the iOS implementation in CredentialProviderViewController.swift:366
     */
    private fun showSyncErrorAlert(error: Throwable) {
        var title = getString(R.string.connection_error_title)
        var message = getString(R.string.connection_error_message)

        // Check if it's a VaultSyncError and customize message accordingly
        if (error is net.aliasvault.app.vaultstore.VaultSyncError) {
            when (error) {
                is net.aliasvault.app.vaultstore.VaultSyncError.SessionExpired,
                is net.aliasvault.app.vaultstore.VaultSyncError.AuthenticationFailed,
                -> {
                    title = getString(R.string.session_expired_title)
                    message = getString(R.string.session_expired_message)
                }

                is net.aliasvault.app.vaultstore.VaultSyncError.PasswordChanged -> {
                    title = getString(R.string.password_changed_title)
                    message = getString(R.string.password_changed_message)
                }

                is net.aliasvault.app.vaultstore.VaultSyncError.ClientVersionNotSupported -> {
                    title = getString(R.string.version_not_supported_title)
                    message = getString(R.string.version_not_supported_message)
                }

                is net.aliasvault.app.vaultstore.VaultSyncError.ServerVersionNotSupported -> {
                    title = getString(R.string.server_version_not_supported_title)
                    message = getString(R.string.server_version_not_supported_message)
                }

                is net.aliasvault.app.vaultstore.VaultSyncError.ServerUnavailable -> {
                    title = getString(R.string.server_unavailable_title)
                    message = getString(R.string.server_unavailable_message)
                }

                is net.aliasvault.app.vaultstore.VaultSyncError.NetworkError,
                is net.aliasvault.app.vaultstore.VaultSyncError.Timeout,
                -> {
                    title = getString(R.string.network_error_title)
                    message = getString(R.string.network_error_message)
                }

                else -> {
                    // Use default connectivity error message for other errors
                }
            }
        }

        hideLoading()

        // Create and show alert dialog
        val alert = android.app.AlertDialog.Builder(requireContext())
            .setTitle(title)
            .setMessage(message)
            .setPositiveButton(android.R.string.ok) { dialog, _ ->
                dialog.dismiss()
            }
            .create()

        alert.show()
    }
}
