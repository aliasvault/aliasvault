package net.aliasvault.app.credentialprovider

import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.TextView
import androidx.activity.viewModels
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.provider.PendingIntentHandler
import androidx.fragment.app.FragmentActivity
import net.aliasvault.app.R
import net.aliasvault.app.credentialprovider.models.PasskeyRegistrationViewModel
import net.aliasvault.app.utils.Helpers
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider
import net.aliasvault.app.vaultstore.keystoreprovider.KeystoreOperationCallback
import net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider
import org.json.JSONObject

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

            // Get requestJson, clientDataHash, and origin from the request
            viewModel.requestJson = createRequest.requestJson
            viewModel.clientDataHash = createRequest.clientDataHash
            viewModel.origin = createRequest.origin

            // Parse request JSON to extract RP ID and user info
            val requestObj = JSONObject(viewModel.requestJson)

            // Extract RP info
            val rpObj = requestObj.optJSONObject("rp")
            viewModel.rpId = rpObj?.optString("id") ?: ""
            viewModel.rpName = rpObj?.optString("name")?.takeIf { it.isNotEmpty() }

            // Extract user info
            val userObj = requestObj.optJSONObject("user")
            viewModel.userName = userObj?.optString("name")?.takeIf { it.isNotEmpty() }
            viewModel.userDisplayName = userObj?.optString("displayName")?.takeIf { it.isNotEmpty() }
            val userIdB64 = userObj?.optString("id")

            if (viewModel.rpId.isEmpty() || viewModel.requestJson.isEmpty()) {
                Log.e(TAG, "Missing required parameters")
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

            // Show loading screen first
            setContentView(R.layout.activity_loading)

            // Check if biometric authentication is available before attempting unlock
            if (!vaultStore.isBiometricAuthEnabled()) {
                Log.e(TAG, "Biometric authentication is not enabled or not available")
                showError(getString(R.string.error_biometric_required))
                return
            }

            // Add biometric prompt here to get decryption key and act as user verification as well
            // If biometric prompt is successful, we can proceed with the passkey registration
            // Create new keystore provider instance to avoid using the existing one
            val keystoreProvider = AndroidKeystoreProvider(applicationContext) { this }
            keystoreProvider.retrieveKeyExternal(
                this,
                object : KeystoreOperationCallback {
                    override fun onSuccess(result: String) {
                        try {
                            Log.d(TAG, "Got decrypt key: ${result.length} bytes")
                            // Biometric authentication successful, now proceed with passkey registration
                            // (Re)unlock the vault now that the decryption key is available
                            vaultStore.initEncryptionKey(result)
                            vaultStore.unlockVault()
                            runOnUiThread {
                                proceedWithPasskeyRegistration(savedInstanceState)
                            }
                        } catch (e: Exception) {
                            Log.e(TAG, "Failed to unlock vault after biometric auth", e)
                            runOnUiThread {
                                showUnlockError(e)
                            }
                        }
                    }

                    override fun onError(e: Exception) {
                        Log.e(TAG, "Failed to retrieve encryption key", e)
                        runOnUiThread {
                            showKeychainError(e)
                        }
                    }
                },
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error in onCreate", e)
            finish()
        }
    }

    /**
     * Proceed with passkey registration after biometric authentication.
     */
    private fun proceedWithPasskeyRegistration(savedInstanceState: Bundle?) {
        try {
            // Check for existing passkeys
            val db = vaultStore.database

            if (db != null) {
                viewModel.existingPasskeys = vaultStore.getPasskeysWithCredentialInfo(
                    rpId = viewModel.rpId,
                    userName = viewModel.userName,
                    userId = viewModel.userId,
                )
            }

            // Set content view with fragment container
            setContentView(R.layout.activity_passkey_registration_container)

            // Only initialize fragments if this is a fresh onCreate (not a configuration change)
            if (savedInstanceState == null) {
                // Decide which fragment to show
                if (viewModel.existingPasskeys.isEmpty()) {
                    // No existing passkeys - show form directly
                    showFormFragment(isReplace = false, passkeyId = null)
                } else {
                    // Existing passkeys found - show selection view
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
     * Show form fragment for creating or replacing a passkey.
     */
    private fun showFormFragment(isReplace: Boolean, passkeyId: String?) {
        val fragment = PasskeyFormFragment.newInstance(isReplace, passkeyId)
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragmentContainer, fragment)
            .commit()
    }

    /**
     * Show error message when unlocking vault fails.
     */
    private fun showUnlockError(e: Exception) {
        val errorMessage = when {
            e.message?.contains("No encryption key found", ignoreCase = true) == true ->
                getString(R.string.error_unlock_vault_first)
            e.message?.contains("Database setup error", ignoreCase = true) == true ->
                getString(R.string.error_vault_decrypt_failed)
            else -> getString(R.string.error_vault_unlock_failed)
        }
        showError(errorMessage)
    }

    /**
     * Show error message when retrieving key from keychain fails.
     */
    private fun showKeychainError(e: Exception) {
        val errorMessage = when {
            e.message?.contains("user canceled", ignoreCase = true) == true ||
                e.message?.contains("authentication failed", ignoreCase = true) == true ->
                getString(R.string.error_biometric_cancelled)
            else -> getString(R.string.error_encryption_key_failed)
        }
        showError(errorMessage)
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
