package net.aliasvault.app.autofill.utils

import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import net.aliasvault.app.credentialprovider.OriginVerifier
import org.json.JSONObject
import java.security.MessageDigest

/**
 * Decides whether an autofill caller is a browser that may report the web domain it is showing.
 */
object BrowserAllowlist {
    private const val TAG = "AliasVaultAutofill"

    /** Allowed SHA-256 certificate fingerprints per browser package. */
    private val fingerprintsByPackage: Map<String, Set<String>> by lazy { parseAllowlist(OriginVerifier.PRIVILEGED_ALLOWLIST_JSON) }

    /**
     * Whether [packageName] is a listed browser and the installed app is signed with a listed certificate.
     */
    fun isTrustedBrowser(context: Context, packageName: String): Boolean {
        val allowed = fingerprintsByPackage[packageName] ?: return false

        return try {
            @Suppress("DEPRECATION")
            val signingInfo = context.packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo ?: return false
            val certs = if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners else signingInfo.signingCertificateHistory
            val md = MessageDigest.getInstance("SHA-256")
            val trusted = certs.orEmpty().any { cert ->
                md.reset()
                md.digest(cert.toByteArray()).joinToString("") { "%02X".format(it) } in allowed
            }
            if (!trusted) {
                Log.w(TAG, "Signing certificate of $packageName does not match the browser allowlist")
            }
            trusted
        } catch (e: PackageManager.NameNotFoundException) {
            Log.w(TAG, "Browser package $packageName not visible or not installed", e)
            false
        }
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
