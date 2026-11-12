package net.aliasvault.app.credentialprovider

import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.credentials.CreateCredentialRequest
import android.service.credentials.CredentialProviderService
import android.service.credentials.GetCredentialRequest
import android.util.Base64
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.credentials.provider.CallingAppInfo
import net.aliasvault.app.R
import net.aliasvault.app.rustcore.JnaInitializer
import net.aliasvault.app.utils.AppSigners
import net.aliasvault.app.utils.TrustedAppStore
import org.json.JSONArray
import org.json.JSONObject
import uniffi.aliasvault_core.isRelatedOriginAllowed
import uniffi.aliasvault_core.isRpIdAllowedForHost
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest

/**
 * Validates caller origin for WebAuthn credential requests. Browsers and native apps are verified differently, because
 * a browser asks on behalf of any website it shows, while a native app only asks for itself.
 *
 * Browsers: the browser reports the website itself, so that claim is only accepted from a browser on
 * the privileged apps list ([privilegedApps], package name + signing key) or one the user trusted in [TrustedAppStore].
 * CallingAppInfo.getOrigin() then returns the website, e.g. `https://example.com`.
 *
 * Native apps: the origin is the app's own signing key, `android:apk-key-hash:<base64url SHA-256>`, and the website must
 * claim the app in `https://<rpId>/.well-known/assetlinks.json` (an app the user trusted in [TrustedAppStore] skips this):
 * ```
 * [{
 *   "relation": ["delegate_permission/common.get_login_creds"],
 *   "target": { "namespace": "android_app", "package_name": "com.example.app", "sha256_cert_fingerprints": ["AB:CD:..."] }
 * }]
 * ```
 *
 * Reference: https://developer.android.com/identity/sign-in/credential-provider
 */
class OriginVerifier(private val context: Context) {

    companion object {
        private const val TAG = "OriginVerifier"

        private const val MAX_RELATED_ORIGINS_BYTES = 64 * 1024
        private val RP_ID_HOST_REGEX = Regex("^[a-z0-9-]+(\\.[a-z0-9-]+)+\\.?$")

        @Volatile
        private var privilegedAppsJson: String? = null

        /**
         * The web origin the caller of the passkey request in [intent] claims to show, unverified. Null when the caller
         * claims none or Android is older than 14.
         */
        fun claimedOrigin(intent: Intent): String? {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return null
            val getRequest = intent.getParcelableExtra(CredentialProviderService.EXTRA_GET_CREDENTIAL_REQUEST, GetCredentialRequest::class.java)
            val createRequest = intent.getParcelableExtra(CredentialProviderService.EXTRA_CREATE_CREDENTIAL_REQUEST, CreateCredentialRequest::class.java)
            return (getRequest?.callingAppInfo ?: createRequest?.callingAppInfo)?.origin
        }

        /**
         * The privileged apps list in res/raw/privileged_apps.json: Google's list combined with other open-source lists.
         * Read once per process. Refresh with: ./scripts/dependencies/02-refresh-external-dependencies.sh privileged-apps
         */
        fun privilegedApps(context: Context): String {
            return privilegedAppsJson ?: context.applicationContext.resources.openRawResource(R.raw.privileged_apps)
                .bufferedReader().use { it.readText() }
                .also { privilegedAppsJson = it }
        }
    }

    /** Result of origin verification. */
    sealed class OriginResult {
        /**
         * Origin was successfully verified.
         * @property origin The verified origin string.
         * @property isPrivileged True if the caller is a privileged app (browser).
         */
        data class Success(val origin: String, val isPrivileged: Boolean) : OriginResult()

        /**
         * Origin verification failed.
         * @property reason Human-readable reason for failure.
         */
        data class Failure(val reason: String) : OriginResult()

        /**
         * The caller could not be verified (a browser that is not on the list, or an app the RP does not list in its
         * asset links) and the user may trust it to retry.
         * @property packageName Package name of the caller.
         * @property signers Signing certificates of the caller, which a trust given by the user is bound to.
         */
        data class UntrustedApp(val packageName: String, val signers: AppSigners) : OriginResult()
    }

    /** Result of asset links verification: the RP lists the app, does not list it, or could not be checked. */
    private sealed class AssetLinksResult {
        data object Success : AssetLinksResult()
        data class NotLinked(val reason: String) : AssetLinksResult()
        data class Unreachable(val reason: String) : AssetLinksResult()
    }

    /**
     * Verify and compute the origin for a credential request.
     */
    @RequiresApi(Build.VERSION_CODES.P)
    fun verifyOrigin(
        callingAppInfo: CallingAppInfo?,
        requestedRpId: String,
    ): OriginResult {
        if (callingAppInfo == null) {
            Log.e(TAG, "CallingAppInfo is null - cannot verify origin")
            return OriginResult.Failure("Cannot identify calling application")
        }

        val packageName = callingAppInfo.packageName
        Log.d(TAG, "Verifying origin for package: $packageName, rpId: $requestedRpId")

        val signers = AppSigners.from(callingAppInfo.signingInfo)
        if (signers == null) {
            Log.e(TAG, "No signing certificates found for $packageName")
            return OriginResult.Failure("Cannot verify calling application signature")
        }
        Log.d(TAG, "Certificate fingerprints for $packageName: ${signers.history}")

        if (!callingAppInfo.isOriginPopulated()) {
            return verifyNativeApp(callingAppInfo, packageName, signers, requestedRpId)
        }

        val privilegedOrigin = privilegedOrigin(callingAppInfo, signers)
        if (privilegedOrigin == null) {
            Log.w(TAG, "$packageName claims a web origin but is not a trusted app")
            return OriginResult.UntrustedApp(packageName, signers)
        }

        Log.d(TAG, "Privileged caller detected, origin: $privilegedOrigin")
        if (!isOriginValidForRpId(privilegedOrigin, requestedRpId)) {
            Log.w(TAG, "Privileged origin $privilegedOrigin does not match rpId $requestedRpId")
            return OriginResult.Failure("Origin does not match RP ID")
        }

        return OriginResult.Success(privilegedOrigin, isPrivileged = true)
    }

    /**
     * The web origin claimed by a browser on Google's list or by an app the user trusted with these [signers], or null for
     * any other caller.
     */
    @RequiresApi(Build.VERSION_CODES.P)
    private fun privilegedOrigin(callingAppInfo: CallingAppInfo, signers: AppSigners): String? {
        listedOrigin(callingAppInfo, privilegedApps(context))?.let { return it }
        if (!TrustedAppStore.isTrusted(context, callingAppInfo.packageName, signers)) {
            return null
        }

        /*
         * androidx returns the origin only through its own allowlist check, which looks at just the original certificate of a
         * rotated key and at the first entry per package. The trust is decided above, so this allowlist names only this caller.
         */
        return listedOrigin(callingAppInfo, allowlistOf(callingAppInfo.packageName, signers))
    }

    /** The origin of [callingAppInfo] when [allowlistJson] lists it, otherwise null. */
    @RequiresApi(Build.VERSION_CODES.P)
    private fun listedOrigin(callingAppInfo: CallingAppInfo, allowlistJson: String): String? {
        return try {
            callingAppInfo.getOrigin(allowlistJson)
        } catch (e: Exception) {
            Log.d(TAG, "Caller not on the allowlist or getOrigin failed: ${e.message}")
            null
        }
    }

    /** An allowlist in the format of Google's list that names only [packageName] with all certificates in [signers]. */
    private fun allowlistOf(packageName: String, signers: AppSigners): String {
        val signatures = JSONArray()
        signers.history.forEach { signatures.put(JSONObject().put("build", "release").put("cert_fingerprint_sha256", it.chunked(2).joinToString(":"))) }
        val app = JSONObject().put("type", "android").put("info", JSONObject().put("package_name", packageName).put("signatures", signatures))
        return JSONObject().put("apps", JSONArray().put(app)).toString()
    }

    /**
     * Verify a native app by its signing certificate: the user trusted it, or the RP lists it in its asset links.
     */
    @RequiresApi(Build.VERSION_CODES.P)
    private fun verifyNativeApp(callingAppInfo: CallingAppInfo, packageName: String, signers: AppSigners, requestedRpId: String): OriginResult {
        val facetId = computeFacetId(callingAppInfo)
        if (facetId == null) {
            Log.e(TAG, "Failed to compute facetId for $packageName")
            return OriginResult.Failure("Cannot verify calling application signature")
        }

        Log.d(TAG, "Native app detected, facetId: $facetId")
        if (TrustedAppStore.isTrusted(context, packageName, signers)) {
            Log.d(TAG, "User trusted $packageName, skipping asset links verification for $requestedRpId")
            return OriginResult.Success(facetId, isPrivileged = false)
        }

        // Only a definite "not listed" may be overridden by the user; a lookup that failed must not lead to permanent trust.
        return when (val assetLinksResult = verifyAssetLinks(requestedRpId, packageName, signers.history)) {
            is AssetLinksResult.Unreachable -> {
                Log.e(TAG, "Asset links lookup failed for $packageName on $requestedRpId: ${assetLinksResult.reason}")
                OriginResult.Failure(assetLinksResult.reason)
            }
            is AssetLinksResult.NotLinked -> {
                Log.e(TAG, "Asset links verification failed for $packageName on $requestedRpId: ${assetLinksResult.reason}")
                OriginResult.UntrustedApp(packageName, signers)
            }
            AssetLinksResult.Success -> {
                Log.d(TAG, "Asset links verification passed for $packageName on $requestedRpId")
                OriginResult.Success(facetId, isPrivileged = false)
            }
        }
    }

    /**
     * Compute the facetId (origin) for a native Android app.
     * Format: android:apk-key-hash:<base64url-encoded-sha256>
     */
    @RequiresApi(Build.VERSION_CODES.P)
    private fun computeFacetId(callingAppInfo: CallingAppInfo): String? {
        return try {
            val signingInfo = callingAppInfo.signingInfo
            val signers = signingInfo.apkContentsSigners
            if (signers.isEmpty()) {
                Log.e(TAG, "No signing certificates found for ${callingAppInfo.packageName}")
                return null
            }

            val cert = signers[0].toByteArray()
            val md = MessageDigest.getInstance("SHA-256")
            val certHash = md.digest(cert)

            // Encode as base64url (no padding, URL-safe characters)
            val base64Hash = Base64.encodeToString(
                certHash,
                Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
            )

            "android:apk-key-hash:$base64Hash"
        } catch (e: Exception) {
            Log.e(TAG, "Error computing facetId", e)
            null
        }
    }

    /**
     * Verify that an https origin may use the given RP ID: its own host, a parent domain that is not a
     * public suffix, or an RP that lists the origin in its /.well-known/webauthn file (related origins).
     */
    private fun isOriginValidForRpId(origin: String, rpId: String): Boolean {
        val url = try {
            URL(origin)
        } catch (e: Exception) {
            Log.w(TAG, "Invalid origin URL: $origin", e)
            return false
        }
        if (url.protocol != "https") {
            Log.w(TAG, "Origin is not HTTPS: $origin")
            return false
        }

        JnaInitializer.ensureInitialized()
        if (isRpIdAllowedForHost(rpId, url.host)) {
            return true
        }

        val callerOrigin = normalizeOrigin(origin) ?: return false
        val relatedOrigins = fetchRelatedOrigins(rpId)
        return relatedOrigins.isNotEmpty() && isRelatedOriginAllowed(callerOrigin, relatedOrigins)
    }

    /**
     * Fetch the origins listed in https://<rpId>/.well-known/webauthn, or an empty list on any failure.
     */
    private fun fetchRelatedOrigins(rpId: String): List<String> {
        val host = rpId.trim().lowercase()
        if (!RP_ID_HOST_REGEX.matches(host) || host.all { it.isDigit() || it == '.' }) {
            return emptyList()
        }

        return try {
            val connection = URL("https://$host/.well-known/webauthn").openConnection() as HttpURLConnection
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            try {
                val contentType = connection.contentType?.substringBefore(';')?.trim()?.lowercase()
                if (connection.responseCode != HttpURLConnection.HTTP_OK || contentType != "application/json" ||
                    connection.contentLengthLong > MAX_RELATED_ORIGINS_BYTES
                ) {
                    return emptyList()
                }

                val body = readLimited(connection) ?: return emptyList()
                val origins = JSONObject(body).optJSONArray("origins") ?: return emptyList()
                (0 until origins.length()).mapNotNull { i -> origins.optString(i, null)?.let(::normalizeOrigin) }
            } finally {
                connection.disconnect()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Related origins lookup failed for $rpId", e)
            emptyList()
        }
    }

    /** Read the response body, or null when it is larger than MAX_RELATED_ORIGINS_BYTES. */
    private fun readLimited(connection: HttpURLConnection): String? {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        connection.inputStream.use { input ->
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                if (output.size() + read > MAX_RELATED_ORIGINS_BYTES) return null
                output.write(buffer, 0, read)
            }
        }
        return output.toString(Charsets.UTF_8.name())
    }

    /** Serialize an origin as scheme://host[:port], lowercased and without a default port, or null if invalid. */
    private fun normalizeOrigin(value: String): String? {
        val uri = runCatching { URI(value) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        val defaultPort = if (scheme == "https") 443 else if (scheme == "http") 80 else -1
        return if (uri.port == -1 || uri.port == defaultPort) "$scheme://$host" else "$scheme://$host:${uri.port}"
    }

    /**
     * Verify that a native app is authorized for the given RP ID via Asset Links.
     * Fetches /.well-known/assetlinks.json and checks for get_login_creds or handle_all_urls permission.
     */
    private fun verifyAssetLinks(rpId: String, packageName: String, certHashes: List<String>): AssetLinksResult {
        return try {
            val assetLinksUrl = URL("https://$rpId/.well-known/assetlinks.json")
            val connection = assetLinksUrl.openConnection() as HttpURLConnection
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
            connection.requestMethod = "GET"

            if (connection.responseCode == HttpURLConnection.HTTP_NOT_FOUND) {
                Log.w(TAG, "Asset links not found for $rpId")
                return AssetLinksResult.NotLinked("$rpId publishes no asset links")
            }
            if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                Log.w(TAG, "Asset links request for $rpId returned ${connection.responseCode}")
                return AssetLinksResult.Unreachable("Could not read the asset links of $rpId (HTTP ${connection.responseCode})")
            }

            val reader = BufferedReader(InputStreamReader(connection.inputStream))
            val response = reader.readText()
            reader.close()

            val assetLinks = JSONArray(response)
            val normalizedCertHashes = certHashes.map { it.replace(":", "").lowercase() }.toSet()

            val found = (0 until assetLinks.length()).any { i ->
                val link = assetLinks.getJSONObject(i)
                isMatchingAssetLink(link, packageName, normalizedCertHashes)
            }

            if (found) {
                Log.d(TAG, "Asset links verification passed for $packageName on $rpId")
                AssetLinksResult.Success
            } else {
                Log.w(TAG, "App $packageName not found in asset links for $rpId")
                AssetLinksResult.NotLinked("App is not authorized to access passkeys for $rpId")
            }
        } catch (e: Exception) {
            Log.w(TAG, "Asset links verification failed for $rpId", e)
            AssetLinksResult.Unreachable("Could not read the asset links of $rpId: ${e.message}")
        }
    }

    /** Check if an asset link entry matches the given package and any of the certificate fingerprints. */
    private fun isMatchingAssetLink(
        link: org.json.JSONObject,
        packageName: String,
        normalizedCertHashes: Set<String>,
    ): Boolean {
        val relation = link.optJSONArray("relation") ?: return false
        val target = link.optJSONObject("target") ?: return false

        if (target.optString("namespace") != "android_app") return false
        if (target.optString("package_name") != packageName) return false

        val hasCredentialRelation = (0 until relation.length()).any { j ->
            val rel = relation.getString(j)
            rel == "delegate_permission/common.get_login_creds" || rel == "delegate_permission/common.handle_all_urls"
        }
        if (!hasCredentialRelation) return false

        val fingerprints = target.optJSONArray("sha256_cert_fingerprints") ?: return false
        return (0 until fingerprints.length()).any { j ->
            fingerprints.getString(j).replace(":", "").lowercase() in normalizedCertHashes
        }
    }
}
