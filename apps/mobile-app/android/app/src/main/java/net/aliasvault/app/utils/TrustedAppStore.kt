package net.aliasvault.app.utils

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Apps the user trusted to request passwords and passkeys for any site, each bound to the signing certificates it had when trusted.
 */
object TrustedAppStore {
    private const val TAG = "AliasVaultAutofill"
    private const val PREFS_NAME = "AliasVaultPrefs"
    private const val PREF_KEY = "trusted_apps"

    /**
     * An app trusted by the user.
     * @property packageName Android package name of the app.
     * @property certFingerprints SHA-256 of the certificates it was signed with, as uppercase hex without colons.
     * @property label App label shown to the user when the trust was given.
     */
    data class TrustedApp(val packageName: String, val certFingerprints: Set<String>, val label: String)

    /**
     * All trusted apps, oldest first.
     */
    @Synchronized
    fun list(context: Context): List<TrustedApp> {
        val json = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_KEY, null) ?: return emptyList()
        return try {
            val array = JSONArray(json)
            (0 until array.length()).mapNotNull { i -> array.optJSONObject(i)?.toTrustedApp() }
        } catch (e: Exception) {
            Log.w(TAG, "Trusted apps preference is not readable, ignoring it", e)
            emptyList()
        }
    }

    /**
     * Whether [packageName] was trusted while signed by exactly the certificates of [signers]; any new certificate, a key rotation
     * included, needs a new trust.
     */
    fun isTrusted(context: Context, packageName: String, signers: AppSigners): Boolean {
        return list(context).any { it.packageName == packageName && it.certFingerprints == signers.current }
    }

    /**
     * Trust [packageName] as signed by [signers], replacing an earlier entry for the same package.
     */
    @Synchronized
    fun trust(context: Context, packageName: String, signers: AppSigners, label: String) {
        val entry = TrustedApp(packageName, signers.current, label)
        save(context, list(context).filter { it.packageName != packageName } + entry)
    }

    /**
     * Remove the trust for [packageName].
     */
    @Synchronized
    fun remove(context: Context, packageName: String) {
        save(context, list(context).filter { it.packageName != packageName })
    }

    /**
     * The trusted apps as a JSON array for the app's settings screen.
     */
    fun listJson(context: Context): String {
        return JSONArray(list(context).map { it.toJson() }).toString()
    }

    private fun save(context: Context, apps: List<TrustedApp>) {
        val json = JSONArray(apps.map { it.toJson() }).toString()
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(PREF_KEY, json).apply()
    }

    private fun TrustedApp.toJson(): JSONObject {
        return JSONObject()
            .put("packageName", packageName)
            .put("certFingerprints", JSONArray(certFingerprints.toList()))
            .put("label", label)
    }

    private fun JSONObject.toTrustedApp(): TrustedApp? {
        val packageName = optString("packageName")
        val fingerprints = optJSONArray("certFingerprints")?.let { array -> (0 until array.length()).map { array.optString(it) } }.orEmpty()
        if (packageName.isEmpty() || fingerprints.isEmpty() || fingerprints.any { it.isEmpty() }) {
            return null
        }
        return TrustedApp(packageName, fingerprints.toSet(), optString("label", packageName))
    }
}
