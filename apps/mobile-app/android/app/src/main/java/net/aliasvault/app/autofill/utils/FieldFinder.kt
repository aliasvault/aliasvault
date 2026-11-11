package net.aliasvault.app.autofill.utils

import android.app.assist.AssistStructure
import android.content.Context
import android.util.Log
import android.view.View
import android.view.autofill.AutofillId
import net.aliasvault.app.autofill.models.FieldType
import net.aliasvault.app.autofill.models.UnverifiedPage

/**
 * Helper class to find fields in the assist structures of a fill request.
 * @param structures The structure of every fill context of the request, oldest first
 * @param context Context used to verify the signature of the calling app
 */
class FieldFinder(private val structures: List<AssistStructure>, private val context: Context) {
    companion object {
        /**
         * The tag for logging.
         */
        private const val TAG = "AliasVaultAutofill"

        /**
         * View id of the URL bar in Chromium-based browsers.
         */
        private const val URL_BAR_ID_ENTRY = "url_bar"
    }

    /**
     * The list of autofillable fields.
     */
    val autofillableFields = mutableListOf<Pair<AutofillId, FieldType>>()

    /**
     * Whether a username field has been found.
     */
    var foundUsernameField = false

    /**
     * Whether a password field has been found.
     */
    var foundPasswordField = false

    /**
     * List of undetected editable fields (not identified as password/username/email).
     */
    private val unknownFields = mutableListOf<AutofillId>()

    /** Fields already classified, so a field found in a newer structure is not classified again from an older one. */
    private val seenIds = mutableSetOf<AutofillId>()

    /** The structure of the latest fill context, which names the app and site. */
    private val structure: AssistStructure get() = structures.last()

    /**
     * Parse the structures, newest first.
     */
    fun parseStructure() {
        /*
         * A later request in the same session can leave out fields of an earlier one that are still on screen (LinkedIn
         * drops its email field when the password field is focused), and its response then serves those fields too.
         */
        for (parsed in structures.asReversed()) {
            for (i in 0 until parsed.windowNodeCount) {
                parseNode(parsed.getWindowNodeAt(i).rootViewNode)
            }
        }

        // If only a password field was found, but there is exactly one other undetected field,
        // assume it's the username/email field
        if (foundPasswordField && !foundUsernameField && unknownFields.size == 1) {
            val unknownFieldId = unknownFields.first()
            Log.d(TAG, "Found password field without username - promoting unknown field to USERNAME type")
            autofillableFields.add(Pair(unknownFieldId, FieldType.USERNAME))
            foundUsernameField = true
        }
    }

    /**
     * Package name of the app that requested autofill.
     */
    val callerPackage: String? get() = structure.activityComponent?.packageName

    private val isTrustedApp: Boolean by lazy { callerPackage?.let { BrowserAllowlist.isTrustedApp(context, it) } ?: false }

    /**
     * The app or website to suggest items for: the web domain when a trusted app reports one, otherwise the
     * package name. Null for a trusted app without a detectable site.
     */
    val appInfo: String? by lazy { resolveAppInfo() }

    /**
     * The web page an app that is not trusted reports; its logins fill only after the user confirms.
     */
    val unverifiedPage: UnverifiedPage? by lazy { resolveUnverifiedPage() }

    /**
     * What the "No match found" and "Open app" rows search for.
     */
    val openAppTarget: String? get() = unverifiedPage?.openAppTarget(appInfo) ?: appInfo

    private fun resolveUnverifiedPage(): UnverifiedPage? {
        val packageName = callerPackage ?: return null
        if (isTrustedApp) {
            return null
        }
        val site = findSite() ?: return null
        return UnverifiedPage(packageName, site, BrowserAllowlist.isBrowser(context, packageName))
    }

    private fun resolveAppInfo(): String? {
        val packageName = callerPackage ?: return null
        if (!isTrustedApp) {
            return packageName
        }

        findSite()?.let { return it }

        Log.d(TAG, "Browser $packageName reported no web domain")
        return null
    }

    private fun findSite(): String? {
        val roots = (0 until structure.windowNodeCount).map { structure.getWindowNodeAt(it).rootViewNode }
        return roots.firstNotNullOfOrNull { findWebDomain(it) } ?: roots.firstNotNullOfOrNull { findUrlBarText(it) }
    }

    /**
     * Determines if a field is most likely an email field, username field, password field, or unknown.
     */
    private fun determineFieldType(node: AssistStructure.ViewNode): FieldType {
        // Check for password field first
        if (isLikelyPasswordField(node)) {
            return FieldType.PASSWORD
        }

        // Check for email-specific indicators
        if (isEmailField(node)) {
            return FieldType.EMAIL
        }

        // Check for username-specific indicators
        if (isUsernameField(node)) {
            return FieldType.USERNAME
        }

        return FieldType.UNKNOWN
    }

    /**
     * Find the first web domain in the node tree, as a URL with its scheme (https when the browser reported none).
     */
    private fun findWebDomain(node: AssistStructure.ViewNode): String? {
        val webDomain = node.webDomain
        if (!webDomain.isNullOrEmpty()) {
            return "${node.webScheme ?: "https"}://$webDomain"
        }
        for (i in 0 until node.childCount) {
            findWebDomain(node.getChildAt(i))?.let { return it }
        }
        return null
    }

    /**
     * Find the URL bar text, which is the only source of the site in compatibility mode.
     */
    private fun findUrlBarText(node: AssistStructure.ViewNode): String? {
        if (node.idEntry == URL_BAR_ID_ENTRY) {
            val text = node.text?.toString()?.trim().orEmpty()
            if (text.isNotEmpty() && !text.contains(' ')) {
                return if (text.contains("://")) text else "https://$text"
            }
        }
        for (i in 0 until node.childCount) {
            findUrlBarText(node.getChildAt(i))?.let { return it }
        }
        return null
    }

    /**
     * Parse a node.
     * @param node The node to parse
     */
    private fun parseNode(node: AssistStructure.ViewNode) {
        val viewId = node.autofillId

        // Consider any editable field as a potential field, except a browser URL bar exposed in compatibility mode
        if (viewId != null && isEditableField(node) && node.idEntry != URL_BAR_ID_ENTRY && seenIds.add(viewId)) {
            val fieldType = determineFieldType(node)

            if (fieldType == FieldType.PASSWORD) {
                foundPasswordField = true
                autofillableFields.add(Pair(viewId, fieldType))
                Log.d(TAG, "Found PASSWORD field: ${node.idEntry}")
            } else if (fieldType == FieldType.USERNAME || fieldType == FieldType.EMAIL) {
                foundUsernameField = true
                autofillableFields.add(Pair(viewId, fieldType))
                Log.d(TAG, "Found ${fieldType.name} field: ${node.idEntry}")
            } else {
                // Store undetected editable fields for potential username promotion
                unknownFields.add(viewId)
                Log.d(TAG, "Found UNKNOWN editable field: ${node.idEntry}, hint=${node.hint}, inputType=${node.inputType}")
            }
        }

        // Recursively parse child nodes
        val childCount = node.childCount
        for (i in 0 until childCount) {
            parseNode(node.getChildAt(i))
        }
    }

    /**
     * Check if a field should be excluded from autofill (e.g., email composition, search fields).
     * @param node The node to check
     * @return Whether the node should be excluded from autofill
     */
    private fun isExcludedField(node: AssistStructure.ViewNode): Boolean {
        val idEntry = node.idEntry?.lowercase()
        val hint = node.hint?.lowercase()
        val contentDescription = node.contentDescription?.toString()?.lowercase()

        // Common patterns for non-login fields that should be excluded
        val excludePatterns = listOf(
            // Email composition fields
            "to", "from", "cc", "bcc", "recipient", "compose", "subject",
            // Search fields
            "search", "query", "find",
            // Other non-login contexts
            "comment", "reply", "message", "chat", "filter",
        )

        // Check if any exclude pattern matches
        for (pattern in excludePatterns) {
            val idEntryContains = idEntry?.contains(pattern, ignoreCase = false) == true
            val hintContains = hint?.contains(pattern, ignoreCase = false) == true
            val contentContains = contentDescription?.contains(pattern, ignoreCase = false) == true

            if (idEntryContains || hintContains || contentContains) {
                return true
            }
        }

        return false
    }

    /**
     * Check if a node is an email field.
     * @param node The node to check
     * @return Whether the node is an email field
     */
    private fun isEmailField(node: AssistStructure.ViewNode): Boolean {
        // Exclude non-login email fields (like "To" in email clients)
        if (isExcludedField(node)) {
            return false
        }

        // Check input type for email - mask to get only the variation bits
        val inputType = node.inputType
        if ((inputType and android.text.InputType.TYPE_MASK_CLASS) == android.text.InputType.TYPE_CLASS_TEXT &&
            (inputType and android.text.InputType.TYPE_MASK_VARIATION) == android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        ) {
            return true
        }

        // Check autofill hints
        val hints = node.autofillHints
        if (hints != null) {
            for (hint in hints) {
                if (hint.contains("email", ignoreCase = true)) {
                    return true
                }
            }
        }

        // Check HTML attributes
        val htmlInfo = node.htmlInfo
        if (htmlInfo != null) {
            val attributes = htmlInfo.attributes
            if (attributes != null) {
                for (i in 0 until attributes.size) {
                    val name = attributes.get(i)?.first
                    val value = attributes.get(i)?.second
                    if (name == "type" && value == "email") {
                        return true
                    }
                    if (name == "name" && value?.contains("email", ignoreCase = true) == true) {
                        return true
                    }
                }
            }
        }

        // Check ID and hint text
        val idEntry = node.idEntry
        val hint = node.hint
        if (idEntry?.contains("email", ignoreCase = true) == true ||
            hint?.contains("email", ignoreCase = true) == true
        ) {
            return true
        }

        return false
    }

    /**
     * Check if a node is a username field.
     * @param node The node to check
     * @return Whether the node is a username field
     */
    private fun isUsernameField(node: AssistStructure.ViewNode): Boolean {
        // Exclude non-login fields
        if (isExcludedField(node)) {
            return false
        }

        val searchTerms = listOf("username", "user")

        // Check autofill hints
        val hints = node.autofillHints
        if (hints != null) {
            for (hint in hints) {
                if (hint == View.AUTOFILL_HINT_USERNAME ||
                    searchTerms.any { term -> hint.contains(term, ignoreCase = true) }
                ) {
                    return true
                }
            }
        }

        // Check HTML attributes
        val htmlInfo = node.htmlInfo
        if (htmlInfo != null) {
            val attributes = htmlInfo.attributes
            if (attributes != null) {
                for (i in 0 until attributes.size) {
                    val name = attributes.get(i)?.first
                    val value = attributes.get(i)?.second
                    if (name == "name" && value != null && searchTerms.any { term ->
                            value.equals(term, ignoreCase = true)
                        }
                    ) {
                        return true
                    }
                }
            }
        }

        // Check if ID or hint text contains one of the search terms
        val idEntry = node.idEntry
        val hint = node.hint
        if (searchTerms.any { term ->
                idEntry?.contains(term, ignoreCase = true) == true ||
                    hint?.contains(term, ignoreCase = true) == true
            }
        ) {
            return true
        }

        return false
    }

    /**
     * Check if a node is an editable field.
     * @param node The node to check
     * @return Whether the node is an editable field
     */
    private fun isEditableField(node: AssistStructure.ViewNode): Boolean {
        // Check if the node is editable in any way
        return node.inputType > 0 ||
            node.className?.contains("EditText") == true ||
            node.className?.contains("Input") == true ||
            node.htmlInfo?.tag?.equals("input", ignoreCase = true) == true
    }

    /**
     * Check if a node is a password field.
     * @param node The node to check
     * @return Whether the node is a password field
     */
    private fun isLikelyPasswordField(node: AssistStructure.ViewNode): Boolean {
        // Try to determine if this is a password field
        val hints = node.autofillHints
        if (hints != null) {
            for (hint in hints) {
                if (hint == View.AUTOFILL_HINT_PASSWORD || hint.contains(
                        "password",
                        ignoreCase = true,
                    )
                ) {
                    return true
                }
            }
        }

        // Check by input type
        val inputType = node.inputType
        val isPasswordType = (
            inputType and android.text.InputType.TYPE_MASK_CLASS == android.text.InputType.TYPE_CLASS_TEXT &&
                (
                    inputType and android.text.InputType.TYPE_MASK_VARIATION == android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                        inputType and android.text.InputType.TYPE_MASK_VARIATION == android.text.InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
                        inputType and android.text.InputType.TYPE_MASK_VARIATION == android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                    )
            ) ||
            (
                inputType and android.text.InputType.TYPE_MASK_CLASS == android.text.InputType.TYPE_CLASS_NUMBER &&
                    inputType and android.text.InputType.TYPE_MASK_VARIATION == android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
                )
        if (isPasswordType) {
            return true
        }

        // Check by ID or text
        val idEntry = node.idEntry
        if (idEntry != null && idEntry.contains("pass", ignoreCase = true)) {
            return true
        }

        // Check by HTML attributes
        val htmlInfo = node.htmlInfo
        if (htmlInfo != null) {
            val attributes = htmlInfo.attributes
            if (attributes != null) {
                for (i in 0 until attributes.size) {
                    val name = attributes.get(i)?.first
                    val value = attributes.get(i)?.second
                    if (name == "type" && value == "password") {
                        return true
                    }
                }
            }
        }

        return false
    }
}
