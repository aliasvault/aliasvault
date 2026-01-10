package net.aliasvault.app.credentialprovider

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import net.aliasvault.app.utils.Helpers
import net.aliasvault.app.vaultstore.models.Item
import net.aliasvault.app.vaultstore.models.Passkey
import net.aliasvault.app.vaultstore.passkey.PasskeyHelper
import org.json.JSONArray
import org.json.JSONObject

/**
 * Android implementation of CredentialIdentityStore.
 *
 * This class stores passkey metadata (rpId, userName, displayName, credentialId, userHandle)
 * in SharedPreferences so that passkeys can be displayed without unlocking the vault.
 *
 * Security features:
 * - Uses MODE_PRIVATE for app-private storage (no other apps can access)
 * - Excluded from device backups (see backup_rules.xml and data_extraction_rules.xml)
 * - Contains no passwords, only metadata (usernames, rpIds, displayNames)
 * - Cleared when credential provider is disabled by user
 *
 * Similar to iOS ASCredentialIdentityStore, but using SharedPreferences as Android's
 * Credential Manager API doesn't provide a system-level identity store.
 */
class CredentialIdentityStore private constructor(context: Context) {

    companion object {
        private const val TAG = "CredentialIdentityStore"
        private const val PREFS_NAME = "credential_identities"
        private const val KEY_PASSKEY_IDENTITIES = "passkey_identities"

        @Volatile
        private var instance: CredentialIdentityStore? = null

        /**
         * Get the singleton instance of CredentialIdentityStore.
         * @param context The application context
         * @return The singleton instance
         */
        fun getInstance(context: Context): CredentialIdentityStore {
            return instance ?: synchronized(this) {
                instance ?: CredentialIdentityStore(context.applicationContext).also { instance = it }
            }
        }
    }

    // MODE_PRIVATE ensures only this app can access the data
    // Backup exclusion rules prevent data from being backed up
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * Data class representing a passkey credential identity.
     * @property passkeyId UUID of the passkey
     * @property rpId Relying Party ID
     * @property userName Username (optional)
     * @property displayName Display name for UI
     * @property credentialId Base64url-encoded credential ID (16-byte GUID)
     * @property userHandle Base64url-encoded user handle (optional)
     */
    data class PasskeyIdentity(
        val passkeyId: String,
        val rpId: String,
        val userName: String?,
        val displayName: String,
        val credentialId: String,
        val userHandle: String?,
    ) {
        companion object {
            /**
             * Create PasskeyIdentity from JSON.
             */
            fun fromJson(json: JSONObject): PasskeyIdentity {
                return PasskeyIdentity(
                    passkeyId = json.getString("passkeyId"),
                    rpId = json.getString("rpId"),
                    userName = if (json.isNull("userName")) null else json.getString("userName"),
                    displayName = json.getString("displayName"),
                    credentialId = json.getString("credentialId"),
                    userHandle = if (json.isNull("userHandle")) null else json.getString("userHandle"),
                )
            }
        }
    }

    /**
     * Save credential identities from a list of credentials.
     * This extracts passkey metadata and stores it in SharedPreferences.
     * @param vaultStore VaultStore instance to query passkeys
     */
    fun saveCredentialIdentities(vaultStore: net.aliasvault.app.vaultstore.VaultStore) {
        try {
            val passkeyIdentities = mutableListOf<PasskeyIdentity>()

            // Get all passkeys with their items in a single efficient query
            // This replaces the N+1 query pattern that was calling getPasskeysForItem() for each item
            val passkeysWithItems = vaultStore.getAllPasskeysWithItems()

            passkeysWithItems.forEach { (passkey, item) ->
                if (!passkey.isDeleted) {
                    passkeyIdentities.add(createPasskeyIdentity(passkey, item))
                }
            }

            // Serialize to JSON and save
            val jsonArray = JSONArray()
            passkeyIdentities.forEach { identity ->
                jsonArray.put(identity.toJson())
            }

            prefs.edit()
                .putString(KEY_PASSKEY_IDENTITIES, jsonArray.toString())
                .apply()
        } catch (e: Exception) {
            Log.e(TAG, "Error saving credential identities", e)
        }
    }

    /**
     * Get all stored passkey identities.
     */
    fun getAllPasskeyIdentities(): List<PasskeyIdentity> {
        return try {
            val jsonString = prefs.getString(KEY_PASSKEY_IDENTITIES, null) ?: return emptyList()
            val jsonArray = JSONArray(jsonString)

            val identities = mutableListOf<PasskeyIdentity>()
            for (i in 0 until jsonArray.length()) {
                val jsonObject = jsonArray.getJSONObject(i)
                identities.add(PasskeyIdentity.fromJson(jsonObject))
            }

            identities
        } catch (e: Exception) {
            Log.e(TAG, "Error reading credential identities", e)
            emptyList()
        }
    }

    /**
     * Get passkey identities for a specific RP ID.
     */
    fun getPasskeyIdentitiesForRpId(rpId: String): List<PasskeyIdentity> {
        return getAllPasskeyIdentities().filter { it.rpId.equals(rpId, ignoreCase = true) }
    }

    /**
     * Get a specific passkey identity by its ID.
     */
    fun getPasskeyIdentityById(passkeyId: String): PasskeyIdentity? {
        return getAllPasskeyIdentities().find { it.passkeyId == passkeyId }
    }

    /**
     * Remove all credential identities.
     */
    fun removeAllCredentialIdentities() {
        prefs.edit()
            .remove(KEY_PASSKEY_IDENTITIES)
            .apply()
    }

    /**
     * Check if the credential identity store is empty.
     * This is used to determine if initial sync is needed.
     * @return true if the store has no credential identities
     */
    fun isStoreEmpty(): Boolean {
        return try {
            val jsonString = prefs.getString(KEY_PASSKEY_IDENTITIES, null)
            jsonString == null || JSONArray(jsonString).length() == 0
        } catch (e: Exception) {
            Log.e(TAG, "Error checking if store is empty", e)
            true // Assume empty if we can't read
        }
    }

    /**
     * Create a PasskeyIdentity from a Passkey and its parent Item.
     */
    private fun createPasskeyIdentity(passkey: Passkey, item: Item): PasskeyIdentity {
        // Get userName - prefer passkey's userName, fallback to item's username or email fields
        val userName = passkey.userName ?: item.username ?: item.email

        // Convert passkey ID to credential ID (base64url-encoded bytes)
        val credentialIdBytes = PasskeyHelper.guidToBytes(passkey.id.toString())
        val credentialId = Helpers.bytesToBase64url(credentialIdBytes)

        // Convert user handle to base64url if present
        val userHandle = passkey.userHandle?.let { Helpers.bytesToBase64url(it) }

        return PasskeyIdentity(
            passkeyId = passkey.id.toString(),
            rpId = passkey.rpId,
            userName = userName,
            displayName = passkey.displayName,
            credentialId = credentialId,
            userHandle = userHandle,
        )
    }

    /**
     * Extension function to convert PasskeyIdentity to JSON.
     */
    private fun PasskeyIdentity.toJson(): JSONObject {
        return JSONObject().apply {
            put("passkeyId", passkeyId)
            put("rpId", rpId)
            put("userName", userName ?: JSONObject.NULL)
            put("displayName", displayName)
            put("credentialId", credentialId)
            put("userHandle", userHandle ?: JSONObject.NULL)
        }
    }
}
