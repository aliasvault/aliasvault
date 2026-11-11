package net.aliasvault.app.autofill.utils

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.util.Log
import net.aliasvault.app.credentialprovider.OriginVerifier
import net.aliasvault.app.utils.TrustedAppStore
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Decides whether a caller may report the web domain it is showing, by its package and signing certificate.
 */
object BrowserAllowlist {
    private const val TAG = "AliasVaultAutofill"

    /** Allowed SHA-256 certificate fingerprints per listed browser package. */
    private val fingerprintsByPackage: Map<String, Set<String>> by lazy { parseAllowlist(OriginVerifier.PRIVILEGED_ALLOWLIST_JSON) }

    /**
     * Whether [packageName] is a listed or user-trusted app and the installed app is signed with the matching certificate.
     */
    fun isTrustedApp(context: Context, packageName: String): Boolean {
        val installed = installedFingerprints(context, packageName) ?: return false
        val listed = fingerprintsByPackage[packageName]
        if (listed != null && installed.any { it in listed }) {
            return true
        }
        if (TrustedAppStore.isTrusted(context, packageName, installed.toSet())) {
            return true
        }
        if (listed != null) {
            Log.w(TAG, "Signing certificate of $packageName does not match the browser allowlist")
        }
        return false
    }

    /**
     * SHA-256 fingerprints (uppercase hex, no colons) of the certificates [packageName] is signed with, the current one
     * last. Null when the package is not installed or not visible.
     */
    fun installedFingerprints(context: Context, packageName: String): List<String>? {
        return try {
            @Suppress("DEPRECATION")
            val signingInfo = context.packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo ?: return null
            val certs = if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners else signingInfo.signingCertificateHistory
            val md = MessageDigest.getInstance("SHA-256")
            certs.orEmpty().map { cert ->
                md.reset()
                md.digest(cert.toByteArray()).joinToString("") { "%02X".format(it) }
            }
        } catch (_: PackageManager.NameNotFoundException) {
            Log.d(TAG, "Package $packageName not visible or not installed")
            null
        }
    }

    /**
     * Whether [packageName] opens any https link, which sets a browser apart from an app that shows a web page inside it.
     */
    @Suppress("DEPRECATION")
    fun isBrowser(context: Context, packageName: String): Boolean {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(packageName)
        return context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_ALL).isNotEmpty()
    }

    /**
     * Google's list and the user's trusted apps as one allowlist for `CallingAppInfo.getOrigin`.
     */
    fun passkeyAllowlistJson(context: Context): String {
        val apps = JSONObject(OriginVerifier.PRIVILEGED_ALLOWLIST_JSON).optJSONArray("apps") ?: JSONArray()
        val userTrusted = TrustedAppStore.toAllowlistApps(context)
        for (i in 0 until userTrusted.length()) {
            apps.put(userTrusted.get(i))
        }
        return JSONObject().put("apps", apps).toString()
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
