package net.aliasvault.app.autofill.utils

import android.util.Log
import net.aliasvault.app.rustcore.JnaInitializer
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.repositories.ItemWithCredentialInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * Wrapper for the Rust item matcher using UniFFI bindings.
 */
object RustItemMatcher {
    private const val TAG = "RustItemMatcher"

    /**
     * Matching mode for credential filtering.
     *
     * @property value The string value used in the Rust API.
     */
    enum class MatchingMode(val value: String) {
        /** Default matching mode - uses subdomain matching. */
        DEFAULT("default"),

        /** Exact URL matching only - no subdomain matching. */
        URL_EXACT("url_exact"),

        /** Subdomain matching - matches subdomains and root domains. */
        URL_SUBDOMAIN("url_subdomain"),
    }

    init {
        // Ensure JNA is initialized before any UniFFI calls
        JnaInitializer.ensureInitialized()
    }

    /**
     * Filter items based on app/website info using the Rust core credential matcher.
     *
     * @param items List of items to filter
     * @param searchText Search term (app package name, URL, or text)
     * @return Filtered list of items
     */
    fun filterItemsByAppInfo(
        items: List<Item>,
        searchText: String,
    ): List<Item> {
        // Early return for empty search
        if (searchText.isEmpty()) {
            return items
        }

        try {
            // Convert items to JSON format expected by Rust
            val rustCredentials = JSONArray()
            val itemMap = mutableMapOf<String, Item>()

            for (item in items) {
                val idString = item.id.toString()
                val urlsArray = JSONArray()
                item.urls.forEach { urlsArray.put(it) }
                val credJson = JSONObject().apply {
                    put("Id", idString)
                    put("ItemName", item.name ?: JSONObject.NULL)
                    put("ItemUrls", urlsArray)
                    put("Username", item.username ?: JSONObject.NULL)
                }
                rustCredentials.put(credJson)
                itemMap[idString] = item
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

            // Convert matched IDs back to items, maintaining order
            val filtered = mutableListOf<Item>()
            for (i in 0 until matchedIds.length()) {
                val id = matchedIds.getString(i)
                itemMap[id]?.let { filtered.add(it) }
            }

            return filtered
        } catch (e: Exception) {
            Log.e(TAG, "Error filtering items with Rust matcher: ${e.message}", e)
            // Fallback to returning all items on error
            return items
        }
    }

    /**
     * Filter ItemWithCredentialInfo items based on rpId using the Rust core credential matcher.
     * Used during passkey registration to find existing credentials that can have a passkey merged into them.
     *
     * @param items List of items to filter (without passkeys).
     * @param rpId The relying party identifier (domain) to match against.
     * @param rpName The relying party name (used for title matching fallback).
     * @param matchingMode The matching mode to use (default: URL_SUBDOMAIN).
     * @return List of items that match the rpId, in priority order.
     */
    fun filterItemsForPasskeyMerge(
        items: List<ItemWithCredentialInfo>,
        rpId: String,
        rpName: String? = null,
        matchingMode: MatchingMode = MatchingMode.URL_SUBDOMAIN,
    ): List<ItemWithCredentialInfo> {
        // Early return for empty rpId or items
        if (rpId.isEmpty() || items.isEmpty()) {
            return emptyList()
        }

        try {
            // Convert items to JSON format expected by Rust
            val rustCredentials = JSONArray()
            val itemMap = mutableMapOf<String, ItemWithCredentialInfo>()

            for (item in items) {
                val idString = item.itemId.toString()
                val urlsArray = JSONArray()
                item.urls.forEach { urlsArray.put(it) }

                val credJson = JSONObject().apply {
                    put("Id", idString)
                    put("ItemName", item.serviceName ?: JSONObject.NULL)
                    put("ItemUrls", urlsArray)
                    put("Username", item.username ?: JSONObject.NULL)
                }
                rustCredentials.put(credJson)
                itemMap[idString] = item
            }

            // Prepare input JSON for Rust
            // Use https:// prefix for the rpId to match URL format
            val input = JSONObject().apply {
                put("credentials", rustCredentials)
                put("current_url", "https://$rpId")
                put("page_title", rpName ?: "")
                put("matching_mode", matchingMode.value)
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

            // Convert matched IDs back to items, maintaining Rust's priority order
            val result = mutableListOf<ItemWithCredentialInfo>()
            for (i in 0 until matchedIds.length()) {
                val id = matchedIds.getString(i)
                itemMap[id]?.let {
                    result.add(it)
                }
            }

            return result
        } catch (e: Exception) {
            Log.e(TAG, "Error filtering items for passkey merge: ${e.message}", e)
            // Return empty list on error
            return emptyList()
        }
    }
}
