package net.aliasvault.app.utils

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.content.pm.SigningInfo
import android.os.Bundle
import android.util.Log
import java.security.MessageDigest

/**
 * The signing certificates of an app as SHA-256 fingerprints in uppercase hex without colons.
 * @property history Every certificate the app may use, oldest first and the current one last; all signers for an app with multiple signers.
 * @property hasMultipleSigners Whether the app is signed by several certificates at once, which are then all current.
 */
data class AppSigners(val history: List<String>, val hasMultipleSigners: Boolean) {
    /** The certificates the app is signed with now. */
    val current: Set<String> get() = if (hasMultipleSigners) history.toSet() else setOf(history.last())

    /** These signers as a bundle for an intent extra. */
    fun toBundle(): Bundle = Bundle().apply {
        putStringArrayList(KEY_HISTORY, ArrayList(history))
        putBoolean(KEY_MULTIPLE_SIGNERS, hasMultipleSigners)
    }

    companion object {
        private const val TAG = "AppSigners"
        private const val KEY_HISTORY = "history"
        private const val KEY_MULTIPLE_SIGNERS = "multipleSigners"

        /** The signers in [signingInfo], or null when it holds no certificate. */
        fun from(signingInfo: SigningInfo): AppSigners? {
            val multiple = signingInfo.hasMultipleSigners()
            val certs = if (multiple) signingInfo.apkContentsSigners else signingInfo.signingCertificateHistory ?: signingInfo.apkContentsSigners
            val fingerprints = certs.orEmpty().map(::fingerprint)
            return if (fingerprints.isEmpty()) null else AppSigners(fingerprints, multiple)
        }

        /** The signers of the installed [packageName], or null when it is not installed or not visible to AliasVault. */
        fun installed(context: Context, packageName: String): AppSigners? {
            return try {
                @Suppress("DEPRECATION")
                val signingInfo = context.packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES).signingInfo ?: return null
                from(signingInfo)
            } catch (_: PackageManager.NameNotFoundException) {
                Log.d(TAG, "Package $packageName not visible or not installed")
                null
            }
        }

        /** The signers stored by [toBundle], or null when [bundle] holds none. */
        fun fromBundle(bundle: Bundle?): AppSigners? {
            val history = bundle?.getStringArrayList(KEY_HISTORY)?.takeIf { it.isNotEmpty() } ?: return null
            return AppSigners(history, bundle.getBoolean(KEY_MULTIPLE_SIGNERS))
        }

        private fun fingerprint(cert: Signature): String {
            return MessageDigest.getInstance("SHA-256").digest(cert.toByteArray()).joinToString("") { "%02X".format(it) }
        }
    }
}
