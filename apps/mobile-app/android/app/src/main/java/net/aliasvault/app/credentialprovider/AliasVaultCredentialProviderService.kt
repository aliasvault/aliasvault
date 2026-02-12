package net.aliasvault.app.credentialprovider

import android.app.PendingIntent
import android.content.Intent
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import android.util.Log
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialUnknownException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginCreatePublicKeyCredentialRequest
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import androidx.credentials.provider.CreateEntry
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import androidx.credentials.provider.PublicKeyCredentialEntry
import net.aliasvault.app.vaultstore.VaultStore
import net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider
import net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider
import org.json.JSONObject

/**
 * AliasVault Credential Provider Service
 *
 * Implements passkey authentication via Android Credential Manager API.
 * This service handles querying vault for matching passkeys and returning entries.
 *
 * Reference: https://developer.android.com/identity/sign-in/credential-provider
 */
class AliasVaultCredentialProviderService : CredentialProviderService() {

    companion object {
        private const val TAG = "AliasVaultCredProvider"

        /** Intent extra key for passing the passkey request JSON. */
        const val EXTRA_REQUEST_JSON = "request_json"

        /** Intent extra key for passing the relying party ID. */
        const val EXTRA_RP_ID = "rp_id"

        /** Intent extra key for passing the passkey ID. */
        const val EXTRA_PASSKEY_ID = "passkey_id"
    }

    /**
     * Called when the system needs to display available credentials for authentication.
     * Uses cached credential identities to show passkeys without unlocking the vault.
     */
    override fun onBeginGetCredentialRequest(
        request: BeginGetCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>,
    ) {
        try {
            // Get credential identity store
            val identityStore = CredentialIdentityStore.getInstance(applicationContext)

            val credentialEntries = mutableListOf<PublicKeyCredentialEntry>()

            // Process each credential option
            for (option in request.beginGetCredentialOptions) {
                when (option) {
                    is BeginGetPublicKeyCredentialOption -> {
                        // This is a passkey request
                        val entries = processPasskeyOptionFromIdentities(option, identityStore)
                        credentialEntries.addAll(entries)
                    }
                }
            }

            callback.onResult(BeginGetCredentialResponse(credentialEntries = credentialEntries))
        } catch (e: Exception) {
            Log.e(TAG, "Error in onBeginGetCredentialRequest", e)
            callback.onResult(BeginGetCredentialResponse())
        }
    }

    /**
     * Process a passkey credential option using cached credential identities.
     * This allows showing passkeys without unlocking the vault.
     */
    private fun processPasskeyOptionFromIdentities(
        option: BeginGetPublicKeyCredentialOption,
        identityStore: CredentialIdentityStore,
    ): List<PublicKeyCredentialEntry> {
        try {
            // Parse the request JSON to extract RP ID and other parameters
            val requestJson = option.requestJson
            val requestObj = JSONObject(requestJson)

            val rpId = requestObj.getString("rpId")
            if (rpId.isEmpty()) {
                Log.w(TAG, "No rpId found in passkey request")
                return emptyList()
            }

            // Get cached passkey identities for this RP ID
            val identities = identityStore.getPasskeyIdentitiesForRpId(rpId)

            // Filter by allowCredentials if specified
            val allowCredentials = requestObj.optJSONArray("allowCredentials")
            val filteredIdentities = if (allowCredentials != null && allowCredentials.length() > 0) {
                val allowedIds = mutableSetOf<String>()
                for (i in 0 until allowCredentials.length()) {
                    val cred = allowCredentials.getJSONObject(i)
                    val id = cred.optString("id", "")
                    if (id.isNotEmpty()) {
                        allowedIds.add(id)
                    }
                }

                identities.filter { identity ->
                    allowedIds.contains(identity.credentialId)
                }
            } else {
                identities
            }

            // Convert to CredentialEntry objects
            return filteredIdentities.map { identity ->
                createPasskeyEntryFromIdentity(identity, option, requestJson)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error processing passkey option from identities", e)
            return emptyList()
        }
    }

    /**
     * Create a PublicKeyCredentialEntry from a cached PasskeyIdentity.
     */
    private fun createPasskeyEntryFromIdentity(
        identity: CredentialIdentityStore.PasskeyIdentity,
        option: BeginGetPublicKeyCredentialOption,
        requestJson: String,
    ): PublicKeyCredentialEntry {
        // Create intent for PasskeyAuthenticationActivity
        val intent = Intent(this, PasskeyAuthenticationActivity::class.java).apply {
            putExtra(EXTRA_REQUEST_JSON, requestJson)
            putExtra(EXTRA_PASSKEY_ID, identity.passkeyId)
            putExtra(EXTRA_RP_ID, identity.rpId)
        }

        val pendingIntent = PendingIntent.getActivity(
            this,
            identity.passkeyId.hashCode(),
            intent,
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        // Use displayName for the UI
        val displayName = identity.displayName.ifEmpty {
            identity.userName ?: identity.rpId
        }

        return PublicKeyCredentialEntry.Builder(
            context = this,
            username = displayName,
            pendingIntent = pendingIntent,
            beginGetPublicKeyCredentialOption = option,
        ).build()
    }

    /**
     * Called when the system needs to display available accounts for credential creation.
     */
    override fun onBeginCreateCredentialRequest(
        request: BeginCreateCredentialRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>,
    ) {
        val response: BeginCreateCredentialResponse? = processCreateCredentialRequest(request)
        if (response != null) {
            callback.onResult(response)
        } else {
            callback.onError(CreateCredentialUnknownException())
        }
    }

    /**
     * Process create credential request.
     */
    private fun processCreateCredentialRequest(
        request: BeginCreateCredentialRequest,
    ): BeginCreateCredentialResponse? {
        // Get or initialize VaultStore instance (needed for subsequent passkey registration)
        VaultStore.getExistingInstance() ?: run {
            // Need a FragmentActivity reference for biometrics, but this is a service
            // We'll create a minimal VaultStore instance here
            val keystoreProvider = AndroidKeystoreProvider(applicationContext) { null }
            val storageProvider = AndroidStorageProvider(applicationContext)
            VaultStore.getInstance(keystoreProvider, storageProvider)
        }

        return when (request) {
            is BeginCreatePublicKeyCredentialRequest -> {
                // Request is passkey type
                handleCreatePasskeyQuery(request)
            }
            else -> {
                // Request type not supported
                Log.w(TAG, "Unsupported credential type: ${request.javaClass.simpleName}")
                null
            }
        }
    }

    /**
     * Handle passkey creation query.
     */
    private fun handleCreatePasskeyQuery(
        request: BeginCreatePublicKeyCredentialRequest,
    ): BeginCreateCredentialResponse {
        try {
            // Parse the request JSON to extract RP ID and user info
            val requestJson = request.requestJson
            val requestObj = JSONObject(requestJson)

            // Extract RP info
            val rpObj = requestObj.optJSONObject("rp")
            val rpId = rpObj?.optString("id")?.takeIf { it.isNotEmpty() } ?: ""
            val rpName = rpObj?.optString("name")?.takeIf { it.isNotEmpty() } ?: rpId

            // Extract user info
            val userObj = requestObj.optJSONObject("user")
            val userName = userObj?.optString("name") ?: ""
            val userDisplayName = userObj?.optString("displayName") ?: userName

            val createEntries = mutableListOf<CreateEntry>()

            /*
             * Always create an entry for AliasVault, even if rpId is empty.
             * Per WebAuthn spec, rpId defaults to the origin's effective domain when not provided.
             * The actual rpId will be derived from the verified origin during registration.
             * Reference: PasskeyRegistrationActivity.kt derives rpId from origin if empty.
             */
            val displayRpName = rpName.ifEmpty { "Passkey" }
            val accountName = if (userDisplayName.isNotEmpty()) {
                "$userDisplayName@$displayRpName"
            } else {
                displayRpName
            }

            val entry = CreateEntry(
                accountName = accountName,
                pendingIntent = createNewPendingIntent(rpId.ifEmpty { "passkey-create" }),
            )

            createEntries.add(entry)

            return BeginCreateCredentialResponse(createEntries)
        } catch (e: Exception) {
            Log.e(TAG, "Error handling passkey create query", e)
            return BeginCreateCredentialResponse(emptyList())
        }
    }

    /**
     * Create a PendingIntent for passkey registration.
     * The intent doesn't need any extras - all data is available via providerRequest.callingRequest
     */
    private fun createNewPendingIntent(rpId: String): PendingIntent {
        val intent = Intent(this, PasskeyRegistrationActivity::class.java)

        return PendingIntent.getActivity(
            this,
            rpId.hashCode(),
            intent,
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    override fun onClearCredentialStateRequest(
        request: ProviderClearCredentialStateRequest,
        cancellationSignal: CancellationSignal,
        callback: OutcomeReceiver<Void?, ClearCredentialException>,
    ) {
        // Called when user signs out or clears credential state
        // For AliasVault, we don't need to do anything here as credentials
        // are managed through the main app
        callback.onResult(null)
    }
}
