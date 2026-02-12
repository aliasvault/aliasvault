package net.aliasvault.app.credentialprovider

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.TextView
import androidx.activity.viewModels
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.provider.CallingAppInfo
import androidx.credentials.provider.PendingIntentHandler
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.aliasvault.app.R
import net.aliasvault.app.credentialprovider.models.PasskeyRegistrationViewModel
import net.aliasvault.app.utils.Helpers
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider
import net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider
import org.json.JSONObject
import java.net.URL

/**
 * PasskeyRegistrationActivity
 *
 * Handles passkey registration (credential creation) with a full UI using fragments.
 * Shows a form where the user can edit the display name, then creates and saves the passkey.
 * Displays loading states and error messages similar to iOS PasskeyRegistrationView.
 *
 * Supports two modes:
 * 1. Selection mode: When existing passkeys are found, shows options to create new or replace existing
 * 2. Form mode: Direct passkey creation form (either new or replacing a selected passkey)
 */
class PasskeyRegistrationActivity : FragmentActivity() {

    companion object {
        private const val TAG = "PasskeyRegistration"
    }

    private val viewModel: PasskeyRegistrationViewModel by viewModels()
    private lateinit var vaultStore: VaultStore
    private lateinit var unlockCoordinator: UnlockCoordinator

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            // Get or initialize VaultStore instance
            vaultStore = VaultStore.getExistingInstance() ?: run {
                val keystoreProvider = AndroidKeystoreProvider(applicationContext) { this }
                val storageProvider = AndroidStorageProvider(applicationContext)
                VaultStore.getInstance(keystoreProvider, storageProvider)
            }

            // Retrieve provider request
            val providerRequest = PendingIntentHandler.retrieveProviderCreateCredentialRequest(intent)
            if (providerRequest == null) {
                Log.e(TAG, "No provider request found in intent")
                finish()
                return
            }

            // Extract parameters from providerRequest.callingRequest
            val createRequest = providerRequest.callingRequest
            if (createRequest !is CreatePublicKeyCredentialRequest) {
                Log.e(TAG, "Request is not a CreatePublicKeyCredentialRequest")
                finish()
                return
            }

            // Get requestJson, clientDataHash from the request
            viewModel.requestJson = createRequest.requestJson
            viewModel.clientDataHash = createRequest.clientDataHash

            // Parse request JSON to extract RP ID and user info
            val requestObj = JSONObject(viewModel.requestJson)

            // Extract RP info
            val rpObj = requestObj.optJSONObject("rp")
            viewModel.rpName = rpObj?.optString("name")?.takeIf { it.isNotEmpty() }

            /*
             * Derive rpId: use explicit rp.id if provided, otherwise fall back to origin hostname.
             * This matches WebAuthn spec behavior where rpId defaults to the origin's effective domain.
             * Reference: browser extension PasskeyAuthenticator.ts and PasskeyCreate.tsx
             */
            val explicitRpId = rpObj?.optString("id")?.takeIf { it.isNotEmpty() }
            viewModel.rpId = explicitRpId ?: ""

            // Extract user info
            val userObj = requestObj.optJSONObject("user")
            viewModel.userName = userObj?.optString("name")?.takeIf { it.isNotEmpty() }
            viewModel.userDisplayName = userObj?.optString("displayName")?.takeIf { it.isNotEmpty() }
            val userIdB64 = userObj?.optString("id")

            if (viewModel.requestJson.isEmpty()) {
                Log.e(TAG, "Missing required parameters: requestJson is empty")
                finish()
                return
            }

            // Decode user ID from base64url
            viewModel.userId = if (!userIdB64.isNullOrEmpty()) {
                try {
                    Helpers.base64urlDecode(userIdB64)
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to decode user ID", e)
                    null
                }
            } else {
                null
            }

            // Show loading screen while verification and unlock are in progress
            setContentView(R.layout.activity_loading)

            // Get calling app info for origin verification
            val callingAppInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                providerRequest.callingAppInfo
            } else {
                null
            }

            // Verify origin and start unlock flow
            verifyOriginAndStartUnlock(callingAppInfo, savedInstanceState)
        } catch (e: Exception) {
            Log.e(TAG, "Error in onCreate", e)
            finish()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        // Delegate PIN unlock result to coordinator
        if (requestCode == UnlockCoordinator.REQUEST_CODE_PIN_UNLOCK) {
            unlockCoordinator.handlePinUnlockResult(resultCode, data)
        }
    }

    /**
     * Update the loading message displayed to the user.
     */
    private fun updateLoadingMessage(messageResId: Int) {
        runOnUiThread {
            try {
                findViewById<TextView>(R.id.loadingMessage)?.text = getString(messageResId)
            } catch (e: Exception) {
                Log.w(TAG, "Could not update loading message", e)
            }
        }
    }

    /**
     * Verify origin on background thread and start unlock flow if successful.
     */
    private fun verifyOriginAndStartUnlock(callingAppInfo: CallingAppInfo?, savedInstanceState: Bundle?) {
        lifecycleScope.launch {
            try {
                // Show verifying status to user (network call may happen)
                updateLoadingMessage(R.string.passkey_verifying)

                // Run origin verification on IO thread (asset links fetch requires network)
                val originVerifier = OriginVerifier()
                val originResult = withContext(Dispatchers.IO) {
                    originVerifier.verifyOrigin(
                        callingAppInfo = callingAppInfo,
                        requestedRpId = viewModel.rpId,
                    )
                }

                when (originResult) {
                    is OriginVerifier.OriginResult.Success -> {
                        viewModel.origin = originResult.origin
                        viewModel.isPrivilegedCaller = originResult.isPrivileged
                        Log.d(TAG, "Origin verified: ${originResult.origin} (privileged: ${originResult.isPrivileged})")

                        /*
                         * If rpId was not provided in the request, derive it from the verified origin.
                         * This matches WebAuthn spec behavior where rpId defaults to origin's effective domain.
                         * Reference: browser extension PasskeyAuthenticator.ts and PasskeyCreate.tsx
                         */
                        if (viewModel.rpId.isEmpty() && originResult.isPrivileged) {
                            try {
                                val originUrl = URL(originResult.origin)
                                viewModel.rpId = originUrl.host
                                Log.d(TAG, "Derived rpId from origin: ${viewModel.rpId}")
                            } catch (e: Exception) {
                                Log.e(TAG, "Failed to derive rpId from origin", e)
                                showError("Invalid origin URL")
                                return@launch
                            }
                        }

                        // Initialize unlock coordinator
                        unlockCoordinator = UnlockCoordinator(
                            activity = this@PasskeyRegistrationActivity,
                            vaultStore = vaultStore,
                            onUnlocked = {
                                // Vault unlocked successfully - proceed with passkey registration
                                proceedWithPasskeyRegistration(savedInstanceState)
                            },
                            onCancelled = {
                                // User cancelled unlock
                                finish()
                            },
                            onError = { errorMessage ->
                                // Error during unlock
                                showError(errorMessage)
                            },
                        )

                        // Start the unlock flow
                        unlockCoordinator.startUnlockFlow()
                    }
                    is OriginVerifier.OriginResult.Failure -> {
                        Log.e(TAG, "Origin verification failed: ${originResult.reason}")
                        showError("Security error: ${originResult.reason}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error verifying origin", e)
                showError("Error verifying application: ${e.message}")
            }
        }
    }

    /**
     * Proceed with passkey registration after authentication (biometric or PIN).
     */
    private fun proceedWithPasskeyRegistration(savedInstanceState: Bundle?) {
        try {
            // Check for existing passkeys
            val db = vaultStore.database

            if (db != null) {
                // Get existing passkeys for the rpId (can be replaced)
                viewModel.existingPasskeys = vaultStore.getPasskeysWithCredentialInfo(
                    rpId = viewModel.rpId,
                    userId = viewModel.userId,
                )

                // Get existing Items without passkeys (can have passkey merged into them)
                // Note: Don't filter by userName here - we want to show all matching items
                // regardless of username so user can choose which item to merge into
                viewModel.existingItemsWithoutPasskey = vaultStore.getItemsWithoutPasskeyForRpId(
                    rpId = viewModel.rpId,
                    rpName = viewModel.rpName,
                )
            }

            // Set content view with fragment container
            setContentView(R.layout.activity_passkey_registration_container)

            // Only initialize fragments if this is a fresh onCreate (not a configuration change)
            if (savedInstanceState == null) {
                // Decide which fragment to show
                val hasExistingPasskeys = viewModel.existingPasskeys.isNotEmpty()
                val hasExistingItems = viewModel.existingItemsWithoutPasskey.isNotEmpty()

                if (!hasExistingPasskeys && !hasExistingItems) {
                    // No existing passkeys or items - show form directly
                    showFormFragment(isReplace = false, passkeyId = null, itemId = null)
                } else {
                    // Existing passkeys or items found - show selection view
                    showSelectionFragment()
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error proceeding with passkey registration", e)
            finish()
        }
    }

    /**
     * Show selection fragment when there are existing passkeys.
     */
    private fun showSelectionFragment() {
        val fragment = PasskeySelectionFragment()
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, fragment)
            .commit()
    }

    /**
     * Show form fragment for creating, replacing, or merging a passkey.
     *
     * @param isReplace Whether this is a passkey replacement operation.
     * @param passkeyId The ID of the passkey to replace (if isReplace is true).
     * @param itemId The ID of the existing Item to merge passkey into (if merging).
     */
    fun showFormFragment(isReplace: Boolean, passkeyId: String?, itemId: String? = null) {
        val fragment = PasskeyFormFragment.newInstance(isReplace, passkeyId, itemId)
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, fragment)
            .commit()
    }

    /**
     * Show error message in the loading view and display a close button.
     * Hides the loading indicator and shows the error state.
     */
    private fun showError(message: String) {
        Log.d(TAG, "showError called with message: $message")
        runOnUiThread {
            try {
                // Hide loading indicator
                val loadingIndicator = findViewById<View>(R.id.loadingIndicator)
                loadingIndicator?.visibility = View.GONE
                Log.d(TAG, "Loading indicator hidden")

                // Show error container
                val errorContainer = findViewById<View>(R.id.errorContainer)
                errorContainer?.visibility = View.VISIBLE
                Log.d(TAG, "Error container shown")

                // Set error message
                val errorMessageView = findViewById<TextView>(R.id.errorMessage)
                errorMessageView?.text = message
                Log.d(TAG, "Error message set: $message")

                // Setup close button
                val closeButton = findViewById<com.google.android.material.button.MaterialButton>(R.id.closeButton)
                closeButton?.setOnClickListener {
                    Log.d(TAG, "Close button clicked")
                    finish()
                }
                Log.d(TAG, "Close button listener set")
            } catch (e: Exception) {
                Log.e(TAG, "Error in showError", e)
                // Fallback: just finish the activity
                finish()
            }
        }
    }
}
