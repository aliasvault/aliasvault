package net.aliasvault.app.autofill.models

/**
 * A web page reported by an app AliasVault cannot verify: a browser that is not trusted, or another app showing a page inside it.
 * @property packageName Package name of the app showing the page.
 * @property site The site the page reports, as a URL.
 * @property isBrowser Whether the app is a browser, which the user can trust for every site.
 */
data class UnverifiedPage(val packageName: String, val site: String, val isBrowser: Boolean) {
    /** What the "No match found" and "Open app" rows search for: the site in a browser, otherwise [appInfo]. */
    fun openAppTarget(appInfo: String?): String? = if (isBrowser) site else appInfo
}
