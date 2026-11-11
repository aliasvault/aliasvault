package net.aliasvault.app.autofill.models

import android.content.Intent
import android.os.Bundle
import net.aliasvault.app.utils.AppSigners

/**
 * A web page reported by an app AliasVault cannot verify: a browser that is not trusted, or another app showing a page inside it.
 * @property packageName Package name of the app showing the page.
 * @property site The site the page reports, as a URL.
 * @property isBrowser Whether the app is a browser, which the user can trust for every site.
 * @property signers Signing certificates of the app at the time of the fill request, null when the app is not visible to AliasVault.
 */
data class UnverifiedPage(val packageName: String, val site: String, val isBrowser: Boolean, val signers: AppSigners?) {
    /** What the "No match found" and "Open app" rows search for: the site in a browser, otherwise [appInfo]. */
    fun openAppTarget(appInfo: String?): String? = if (isBrowser) site else appInfo

    /** Store this page in [intent], to be read back with [from]. */
    fun putInto(intent: Intent) {
        val bundle = Bundle().apply {
            putString(KEY_PACKAGE_NAME, packageName)
            putString(KEY_SITE, site)
            putBoolean(KEY_IS_BROWSER, isBrowser)
            putBundle(KEY_SIGNERS, signers?.toBundle())
        }
        intent.putExtra(EXTRA_PAGE, bundle)
    }

    companion object {
        private const val EXTRA_PAGE = "net.aliasvault.app.autofill.EXTRA_UNVERIFIED_PAGE"
        private const val KEY_PACKAGE_NAME = "packageName"
        private const val KEY_SITE = "site"
        private const val KEY_IS_BROWSER = "isBrowser"
        private const val KEY_SIGNERS = "signers"

        /** The page stored in [intent] by [putInto], or null when there is none. */
        fun from(intent: Intent): UnverifiedPage? {
            val bundle = intent.getBundleExtra(EXTRA_PAGE) ?: return null
            val packageName = bundle.getString(KEY_PACKAGE_NAME)
            val site = bundle.getString(KEY_SITE)
            if (packageName.isNullOrEmpty() || site.isNullOrEmpty()) {
                return null
            }
            return UnverifiedPage(packageName, site, bundle.getBoolean(KEY_IS_BROWSER), AppSigners.fromBundle(bundle.getBundle(KEY_SIGNERS)))
        }
    }
}
