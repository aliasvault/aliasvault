package net.aliasvault.app.utils

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Apps the user trusted to request passwords and passkeys for any site, each bound to the signing certificate it had when trusted.
 */
object TrustedAppStore {
    private const val TAG = "AliasVaultAutofill"
    private const val PREFS_NAME = "AliasVaultPrefs"
    private const val PREF_KEY = "trusted_apps"

    /**
     * An app trusted by the user.
     * @property packageName Android package name of the app.
     * @property certFingerprint SHA-256 of its signing certificate as uppercase hex without colons.
     * @property label App label shown to the user when the trust was given.
     * @property trustedAt Epoch milliseconds of the trust decision.
     */
    data class TrustedApp(val packageName: String, val certFingerprint: String, val label: String, val trustedAt: Long)

    /**
     * All trusted apps, oldest first.
     */
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
     * Whether [packageName] was trusted with one of the certificates it is currently signed with.
     */
    fun isTrusted(context: Context, packageName: String, installedFingerprints: Set<String>): Boolean {
        return list(context).any { it.packageName == packageName && it.certFingerprint in installedFingerprints }
    }

    /**
     * Trust [packageName] as signed with [certFingerprint], replacing an earlier entry for the same package.
     */
    fun trust(context: Context, packageName: String, certFingerprint: String, label: String) {
        val entry = TrustedApp(packageName, certFingerprint, label, System.currentTimeMillis())
        save(context, list(context).filter { it.packageName != packageName } + entry)
    }

    /**
     * Remove the trust for [packageName].
     */
    fun remove(context: Context, packageName: String) {
        save(context, list(context).filter { it.packageName != packageName })
    }

    /**
     * The trusted apps as a JSON array for the app's settings screen; entries of uninstalled apps are dropped.
     */
    fun listJson(context: Context): String {
        val installed = list(context).filter { isInstalled(context, it.packageName) }
        if (installed.size != list(context).size) {
            save(context, installed)
        }
        return JSONArray(installed.map { it.toJson() }).toString()
    }

    /**
     * The trusted apps in the format of Google's privileged apps list, for merging into a `CallingAppInfo.getOrigin` allowlist.
     */
    fun toAllowlistApps(context: Context): JSONArray {
        val apps = JSONArray()
        for (app in list(context)) {
            val signature = JSONObject().put("build", "release").put("cert_fingerprint_sha256", app.certFingerprint.chunked(2).joinToString(":"))
            val info = JSONObject().put("package_name", app.packageName).put("signatures", JSONArray().put(signature))
            apps.put(JSONObject().put("type", "android").put("info", info))
        }
        return apps
    }

    private fun save(context: Context, apps: List<TrustedApp>) {
        val json = JSONArray(apps.map { it.toJson() }).toString()
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(PREF_KEY, json).apply()
    }

    private fun isInstalled(context: Context, packageName: String): Boolean {
        return runCatching { context.packageManager.getPackageInfo(packageName, 0) }.isSuccess
    }

    private fun TrustedApp.toJson(): JSONObject {
        return JSONObject().put("packageName", packageName).put("certFingerprint", certFingerprint).put("label", label).put("trustedAt", trustedAt)
    }

    private fun JSONObject.toTrustedApp(): TrustedApp? {
        val packageName = optString("packageName")
        val certFingerprint = optString("certFingerprint")
        if (packageName.isEmpty() || certFingerprint.isEmpty()) {
            return null
        }
        return TrustedApp(packageName, certFingerprint, optString("label", packageName), optLong("trustedAt"))
    }
}
