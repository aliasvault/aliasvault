package net.aliasvault.app.autofill.utils

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Log
import net.aliasvault.app.credentialprovider.OriginVerifier
import net.aliasvault.app.utils.AppSigners
import net.aliasvault.app.utils.TrustedAppStore
import org.json.JSONObject

/**
 * Decides whether a caller may report the web domain it is showing, by its package and signing certificate.
 */
object BrowserAllowlist {
    private const val TAG = "AliasVaultAutofill"

    /** Allowed SHA-256 certificate fingerprints per listed browser package. */
    private val fingerprintsByPackage: Map<String, Set<String>> by lazy { parseAllowlist(OriginVerifier.PRIVILEGED_ALLOWLIST_JSON) }

    /**
     * Whether [packageName], signed by [signers], is a listed browser with a listed certificate or an app the user trusted.
     */
    fun isTrustedApp(context: Context, packageName: String, signers: AppSigners): Boolean {
        val listed = fingerprintsByPackage[packageName]
        if (listed != null && signers.history.any { it in listed }) {
            return true
        }
        if (TrustedAppStore.isTrusted(context, packageName, signers)) {
            return true
        }
        if (listed != null) {
            Log.w(TAG, "Signing certificate of $packageName does not match the browser allowlist")
        }
        return false
    }

    /**
     * Whether [packageName] opens any https link, which sets a browser apart from an app that shows a web page inside it.
     */
    @Suppress("DEPRECATION")
    fun isBrowser(context: Context, packageName: String): Boolean {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(packageName)
        return context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_ALL).isNotEmpty()
    }

    private fun parseAllowlist(json: String): Map<String, Set<String>> {
        val result = mutableMapOf<String, MutableSet<String>>()
        val apps = JSONObject(json).optJSONArray("apps") ?: return result
        for (i in 0 until apps.length()) {
            val app = apps.getJSONObject(i)
            val info = app.optJSONObject("info")
            val signatures = info?.optJSONArray("signatures")
            val packageName = info?.optString("package_name").orEmpty()
            if (app.optString("type") == "android" && packageName.isNotEmpty() && signatures != null) {
                val fingerprints = (0 until signatures.length()).map { signatures.getJSONObject(it).optString("cert_fingerprint_sha256") }
                result.getOrPut(packageName) { mutableSetOf() }.addAll(fingerprints.filter { it.isNotEmpty() }.map { it.replace(":", "").uppercase() })
            }
        }
        return result
    }
}
