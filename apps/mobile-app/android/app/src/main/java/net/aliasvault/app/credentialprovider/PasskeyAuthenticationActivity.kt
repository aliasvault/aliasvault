package net.aliasvault.app.credentialprovider

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.TextView
import androidx.credentials.provider.PendingIntentHandler
import androidx.credentials.provider.ProviderGetCredentialRequest
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import net.aliasvault.app.R
import net.aliasvault.app.utils.Helpers
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider
import net.aliasvault.app.vaultstore.passkey.PasskeyAuthenticator
import net.aliasvault.app.vaultstore.passkey.PasskeyHelper
import net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

/**
 * PasskeyAuthenticationActivity
 *
 * Handles passkey authentication (assertion generation) when user selects a passkey.
 * This activity:
 * 1. Shows biometric prompt to unlock vault (if needed)
 * 2. Retrieves the passkey from the vault
 * 3. Extracts PRF extension inputs if present
 * 4. Generates the WebAuthn assertion using PasskeyAuthenticator
 * 5. Returns the assertion to the calling app
 *
 * Flow:
 * - User selects a passkey from Credential Manager UI
 * - This activity is launched with passkey details
 * - Show biometric prompt to unlock vault (similar to registration flow)
 * - After unlock: generate assertion and return it
 */
class PasskeyAuthenticationActivity : FragmentActivity() {

    companion object {
        private const val TAG = "PasskeyAuthentication"
    }

    private lateinit var vaultStore: VaultStore
    private lateinit var unlockCoordinator: UnlockCoordinator
    private var providerRequest: ProviderGetCredentialRequest? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            // Retrieve provider request
            providerRequest = PendingIntentHandler.retrieveProviderGetCredentialRequest(intent)
            if (providerRequest == null) {
                Log.e(TAG, "No provider request found in intent")
                setResult(RESULT_CANCELED)
                finish()
                return
            }

            // Get or initialize VaultStore instance
            vaultStore = VaultStore.getExistingInstance() ?: run {
                val keystoreProvider = AndroidKeystoreProvider(applicationContext) { this }
                val storageProvider = AndroidStorageProvider(applicationContext)
                VaultStore.getInstance(keystoreProvider, storageProvider)
            }

            // Show loading screen while unlock is in progress
            setContentView(R.layout.activity_loading)

            // Initialize unlock coordinator
            unlockCoordinator = UnlockCoordinator(
                activity = this,
                vaultStore = vaultStore,
                onUnlocked = {
                    // Vault unlocked successfully - process authentication request
                    processAuthenticationRequest()
                },
                onCancelled = {
                    // User cancelled unlock
                    setResult(RESULT_CANCELED)
                    finish()
                },
                onError = { errorMessage ->
                    // Error during unlock
                    showError(errorMessage)
                },
            )

            // Start the unlock flow
            unlockCoordinator.startUnlockFlow()
        } catch (e: Exception) {
            Log.e(TAG, "Error in onCreate", e)
            // Make sure we have the layout set before showing error
            if (findViewById<View>(R.id.errorContainer) == null) {
                setContentView(R.layout.activity_loading)
            }
            showError("An error occurred: ${e.message}")
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
     * Process the passkey authentication request and generate assertion.
     * Called after authentication (biometric or PIN) succeeds and vault is unlocked.
     */
    private fun processAuthenticationRequest() {
        val providerRequest = this.providerRequest ?: run {
            Log.e(TAG, "Provider request is null")
            setResult(RESULT_CANCELED)
            finish()
            return
        }

        lifecycleScope.launch {
            try {
                // Extract passkey ID from intent
                val passkeyIdString = intent.getStringExtra(
                    AliasVaultCredentialProviderService.EXTRA_PASSKEY_ID,
                )
                if (passkeyIdString == null) {
                    Log.e(TAG, "No passkey ID in intent")
                    setResult(RESULT_CANCELED)
                    finish()
                    return@launch
                }

                val passkeyId = UUID.fromString(passkeyIdString.uppercase())

                // Get database connection from vault (should be unlocked at this point)
                val db = vaultStore.database
                if (db == null) {
                    Log.e(TAG, "Database not available - vault may not be unlocked")
                    setResult(RESULT_CANCELED)
                    finish()
                    return@launch
                }

                val passkey = vaultStore.getPasskeyById(passkeyId, db)
                if (passkey == null) {
                    Log.e(TAG, "Passkey not found: $passkeyId")
                    setResult(RESULT_CANCELED)
                    finish()
                    return@launch
                }

                val requestJson = intent.getStringExtra(
                    AliasVaultCredentialProviderService.EXTRA_REQUEST_JSON,
                ) ?: ""
                val requestObj = JSONObject(requestJson)

                // Extract clientDataHash from the calling app's request
                // Browsers (Chrome, Firefox, Edge, etc.) provide this, native apps typically don't
                val providedClientDataHash: ByteArray? = providerRequest.credentialOptions
                    .filterIsInstance<androidx.credentials.GetPublicKeyCredentialOption>()
                    .firstOrNull()?.clientDataHash

                // Verify origin of the calling app (may involve network call for asset links)
                val originVerifier = OriginVerifier()
                val callingAppInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    providerRequest.callingAppInfo
                } else {
                    null
                }

                // Run origin verification on IO thread (asset links fetch requires network)
                val originResult = withContext(Dispatchers.IO) {
                    originVerifier.verifyOrigin(
                        callingAppInfo = callingAppInfo,
                        requestedRpId = passkey.rpId,
                    )
                }

                val verifiedOrigin: String
                val isPrivilegedCaller: Boolean

                when (originResult) {
                    is OriginVerifier.OriginResult.Success -> {
                        verifiedOrigin = originResult.origin
                        isPrivilegedCaller = originResult.isPrivileged
                        Log.d(TAG, "Origin verified: $verifiedOrigin (privileged: $isPrivilegedCaller)")
                    }
                    is OriginVerifier.OriginResult.Failure -> {
                        Log.e(TAG, "Origin verification failed: ${originResult.reason}")
                        showError("Security error: ${originResult.reason}")
                        return@launch
                    }
                }

                // Determine clientDataHash and clientDataJson based on what caller provided
                val clientDataHash: ByteArray
                val clientDataJson: String?
                if (providedClientDataHash != null && isPrivilegedCaller) {
                    // Browser provided clientDataHash - use it directly
                    clientDataHash = providedClientDataHash
                    clientDataJson = null
                } else {
                    // Native app scenario - build clientDataJSON ourselves
                    val challenge = requestObj.optString("challenge", "")
                    val json = buildClientDataJson(challenge, verifiedOrigin)
                    clientDataHash = sha256(json.toByteArray(Charsets.UTF_8))
                    clientDataJson = json
                }

                // Use PasskeyAuthenticator.getAssertion for signing
                val credentialId = PasskeyHelper.guidToBytes(passkey.id.toString())
                val prfInputs = extractPrfInputs(requestObj)
                val assertion = PasskeyAuthenticator.getAssertion(
                    credentialId = credentialId,
                    clientDataHash = clientDataHash,
                    rpId = passkey.rpId,
                    privateKeyJWK = passkey.privateKey,
                    userId = passkey.userHandle,
                    uvPerformed = true,
                    prfInputs = prfInputs,
                    prfSecret = passkey.prfKey,
                )

                // Build response JSON
                val response = buildPublicKeyCredentialResponse(
                    assertion = assertion,
                    clientDataJson = clientDataJson,
                )

                val resultIntent = Intent()
                try {
                    PendingIntentHandler.setGetCredentialResponse(resultIntent, response)
                    setResult(RESULT_OK, resultIntent)
                } catch (e: Exception) {
                    Log.e(TAG, "Error setting credential response", e)
                    try {
                        PendingIntentHandler.setGetCredentialException(
                            resultIntent,
                            androidx.credentials.exceptions.GetCredentialUnknownException("Failed to generate assertion: ${e.message}"),
                        )
                        setResult(RESULT_OK, resultIntent)
                    } catch (e2: Exception) {
                        Log.e(TAG, "Error setting exception", e2)
                        setResult(RESULT_CANCELED)
                    }
                }
                finish()
            } catch (e: Exception) {
                Log.e(TAG, "Error processing authentication request", e)
                setResult(RESULT_CANCELED)
                finish()
            }
        }
    }

    /**
     * Build clientDataJSON for WebAuthn if the caller didn't provide it.
     */
    private fun buildClientDataJson(challenge: String, origin: String): String {
        return """{"type":"webauthn.get","challenge":"$challenge","origin":"$origin","crossOrigin":false}"""
    }

    /**
     * Compute SHA-256 hash.
     */
    private fun sha256(data: ByteArray): ByteArray {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(data)
    }

    /**
     * Extract PRF extension inputs from request.
     */
    private fun extractPrfInputs(requestObj: JSONObject): PasskeyAuthenticator.PrfInputs? {
        try {
            val extensions = requestObj.optJSONObject("extensions") ?: return null
            val prf = extensions.optJSONObject("prf") ?: return null
            val eval = prf.optJSONObject("eval") ?: prf.optJSONObject("evalByCredential") ?: return null

            // PRF inputs are base64url-encoded
            val firstB64 = eval.optString("first") ?: return null
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
     * Build PublicKeyCredential response from PasskeyAuthenticator assertion result.
     *
     * @param assertion The assertion result from PasskeyAuthenticator.getAssertion
     * @param clientDataJson Optional clientDataJSON string. If null, clientDataJSON will be
     *                       omitted from the response (used when Chrome provides clientDataHash)
     */
    private fun buildPublicKeyCredentialResponse(
        assertion: PasskeyAuthenticator.PasskeyAssertionResult,
        clientDataJson: String?,
    ): androidx.credentials.GetCredentialResponse {
        val credentialIdB64 = Helpers.bytesToBase64url(assertion.credentialId)
        val signatureB64 = Helpers.bytesToBase64url(assertion.signature)
        val authDataB64 = Helpers.bytesToBase64url(assertion.authenticatorData)
        val userHandleB64 = assertion.userHandle?.let { Helpers.bytesToBase64url(it) }

        val responseObj = JSONObject().apply {
            put("id", credentialIdB64)
            put("rawId", credentialIdB64)
            put("type", "public-key")
            put("authenticatorAttachment", "cross-platform")

            put(
                "response",
                JSONObject().apply {
                    // Only include clientDataJSON if we built it ourselves
                    // When Chrome provides clientDataHash, omit this field
                    clientDataJson?.let {
                        put("clientDataJSON", Helpers.bytesToBase64url(it.toByteArray(Charsets.UTF_8)))
                    }
                    put("authenticatorData", authDataB64)
                    put("signature", signatureB64)
                    userHandleB64?.let { put("userHandle", it) }
                },
            )

            put(
                "clientExtensionResults",
                assertion.prfResults?.let {
                    JSONObject().apply {
                        put(
                            "prf",
                            JSONObject().apply {
                                put(
                                    "results",
                                    JSONObject().apply {
                                        put("first", Helpers.bytesToBase64url(it.first))
                                        it.second?.let { second -> put("second", Helpers.bytesToBase64url(second)) }
                                    },
                                )
                            },
                        )
                    }
                } ?: JSONObject(),
            )
        }

        return androidx.credentials.GetCredentialResponse(
            androidx.credentials.PublicKeyCredential(responseObj.toString()),
        )
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
                    setResult(RESULT_CANCELED)
                    finish()
                }
                Log.d(TAG, "Close button listener set")
            } catch (e: Exception) {
                Log.e(TAG, "Error in showError", e)
                // Fallback: just finish the activity
                setResult(RESULT_CANCELED)
                finish()
            }
        }
    }
}
