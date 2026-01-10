package net.aliasvault.app.autofill.utils

import android.util.Log
import net.aliasvault.app.rustcore.JnaInitializer
import net.aliasvault.app.vaultstore.models.Credential
import org.json.JSONArray
import org.json.JSONObject

/**
 * Wrapper for the Rust credential matcher using UniFFI bindings.
 */
object RustCredentialMatcher {
    private const val TAG = "RustCredentialMatcher"

    init {
        // Ensure JNA is initialized before any UniFFI calls
        JnaInitializer.ensureInitialized()
    }

    /**
     * Filter credentials based on app/website info using the Rust core credential matcher.
     *
     * @param credentials List of credentials to filter
     * @param searchText Search term (app package name, URL, or text)
     * @return Filtered list of credentials
     */
    fun filterCredentialsByAppInfo(
        credentials: List<Credential>,
        searchText: String,
    ): List<Credential> {
        // Early return for empty search
        if (searchText.isEmpty()) {
            return credentials
        }

        try {
            // Convert credentials to JSON format expected by Rust
            val rustCredentials = JSONArray()
            val credentialMap = mutableMapOf<String, Credential>()

            for (credential in credentials) {
                val idString = credential.id.toString()
                val credJson = JSONObject().apply {
                    put("Id", idString)
                    put("ServiceName", credential.service.name ?: JSONObject.NULL)
                    put("ServiceUrl", credential.service.url ?: JSONObject.NULL)
                    put("Username", credential.username ?: JSONObject.NULL)
                }
                rustCredentials.put(credJson)
                credentialMap[idString] = credential
            }

            // Prepare input JSON for Rust
            val input = JSONObject().apply {
                put("credentials", rustCredentials)
                put("current_url", searchText)
                put("page_title", "")
                put("matching_mode", "default")
            }

            // Call Rust via UniFFI
            val outputJson = uniffi.aliasvault_core.filterCredentialsJson(input.toString())

            // Parse output
            val output = JSONObject(outputJson)
            val matchedIds = output.getJSONArray("matched_ids")

            // If no matches found, return empty list
            if (matchedIds.length() == 0) {
                return emptyList()
            }

            // Convert matched IDs back to credentials, maintaining order
            val filtered = mutableListOf<Credential>()
            for (i in 0 until matchedIds.length()) {
                val id = matchedIds.getString(i)
                credentialMap[id]?.let { filtered.add(it) }
            }

            return filtered
        } catch (e: Exception) {
            Log.e(TAG, "Error filtering credentials with Rust matcher: ${e.message}", e)
            // Fallback to returning all credentials on error
            return credentials
        }
    }
}
