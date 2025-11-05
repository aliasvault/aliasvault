package net.aliasvault.app.autofill.utils

import net.aliasvault.app.vaultstore.models.Credential

/**
 * Helper class to match credentials against app/website information for autofill.
 * This implementation matches the iOS filtering logic exactly for cross-platform consistency.
 */
object CredentialMatcher {

    /**
     * Common top-level domains (TLDs) that should be excluded from matching.
     * This prevents false matches when dealing with reversed domain names (Android package names).
     */
    private val commonTlds = setOf(
        // Generic TLDs
        "com", "net", "org", "edu", "gov", "mil", "int",
        // Country code TLDs
        "nl", "de", "uk", "fr", "it", "es", "pl", "be", "ch", "at", "se", "no", "dk", "fi",
        "pt", "gr", "cz", "hu", "ro", "bg", "hr", "sk", "si", "lt", "lv", "ee", "ie", "lu",
        "us", "ca", "mx", "br", "ar", "cl", "co", "ve", "pe", "ec",
        "au", "nz", "jp", "cn", "in", "kr", "tw", "hk", "sg", "my", "th", "id", "ph", "vn",
        "za", "eg", "ng", "ke", "ug", "tz", "ma",
        "ru", "ua", "by", "kz", "il", "tr", "sa", "ae", "qa", "kw",
        // New gTLDs (common ones)
        "app", "dev", "io", "ai", "tech", "shop", "store", "online", "site", "website",
        "blog", "news", "media", "tv", "video", "music", "pro", "info", "biz", "name",
    )

    /**
     * Check if a string is likely an Android package name (reversed domain).
     * Android package names start with TLD followed by dot (e.g., "com.example", "nl.app").
     * @param text The text to check
     * @return True if it looks like an Android package name
     */
    private fun isAndroidPackageName(text: String): Boolean {
        if (!text.contains(".")) {
            return false
        }

        if (text.startsWith("http://") || text.startsWith("https://")) {
            return false
        }

        val firstPart = text.substringBefore(".").lowercase()

        // Check if first part is a common TLD - this indicates reversed domain (package name)
        return commonTlds.contains(firstPart)
    }

    /**
     * Extract domain from URL, handling both full URLs and partial domains.
     * @param urlString URL or domain string
     * @return Normalized domain without protocol or www, or empty string if not a valid URL/domain
     */
    private fun extractDomain(urlString: String): String {
        if (urlString.isBlank()) {
            return ""
        }

        var domain = urlString.lowercase().trim()

        // Remove protocol if present
        // Check if it starts with a protocol
        val hasProtocol = domain.startsWith("http://") || domain.startsWith("https://")

        // If no protocol and starts with TLD + dot, it's likely an Android package name
        // Return empty string to indicate that domain extraction has failed for this string as
        // this is most likely not a real domain that the caller expects
        if (!hasProtocol && isAndroidPackageName(domain)) {
            return ""
        }

        if (hasProtocol) {
            domain = domain.replace("https://", "").replace("http://", "")
        }

        // Remove www. prefix
        domain = domain.replace("www.", "")

        // Remove path, query, and fragment
        domain = domain.substringBefore("/").substringBefore("?").substringBefore("#")

        // Basic domain validation - must contain at least one dot and valid characters
        // Only validate after removing path/query/fragment
        if (!domain.contains(".") || !domain.matches(Regex("^[a-z0-9.-]+$"))) {
            return ""
        }

        // Final validation - ensure we have a valid domain structure
        if (domain.isEmpty() || domain.startsWith(".") || domain.endsWith(".") || domain.contains("..")) {
            return ""
        }

        return domain
    }

    /**
     * Extract root domain from a domain string.
     * E.g., "sub.example.com" -> "example.com"
     * E.g., "sub.example.com.au" -> "example.com.au"
     * E.g., "sub.example.co.uk" -> "example.co.uk"
     */
    private fun extractRootDomain(domain: String): String {
        val parts = domain.split(".")
        if (parts.size < 2) return domain

        // Common two-level public TLDs
        val twoLevelTlds = setOf(
            // Australia
            "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
            // United Kingdom
            "co.uk", "org.uk", "net.uk", "ac.uk", "gov.uk", "plc.uk", "ltd.uk", "me.uk",
            // Canada
            "co.ca", "net.ca", "org.ca", "gc.ca", "ab.ca", "bc.ca", "mb.ca", "nb.ca", "nf.ca", "nl.ca", "ns.ca", "nt.ca", "nu.ca",
            "on.ca", "pe.ca", "qc.ca", "sk.ca", "yk.ca",
            // India
            "co.in", "net.in", "org.in", "edu.in", "gov.in", "ac.in", "res.in", "gen.in", "firm.in", "ind.in",
            // Japan
            "co.jp", "ne.jp", "or.jp", "ac.jp", "ad.jp", "ed.jp", "go.jp", "gr.jp", "lg.jp",
            // South Africa
            "co.za", "net.za", "org.za", "edu.za", "gov.za", "ac.za", "web.za",
            // New Zealand
            "co.nz", "net.nz", "org.nz", "edu.nz", "govt.nz", "ac.nz", "geek.nz", "gen.nz", "kiwi.nz", "maori.nz", "mil.nz", "school.nz",
            // Brazil
            "com.br", "net.br", "org.br", "edu.br", "gov.br", "mil.br", "art.br", "etc.br", "adv.br", "arq.br", "bio.br", "cim.br",
            "cng.br", "cnt.br", "ecn.br", "eng.br", "esp.br", "eti.br", "far.br", "fnd.br", "fot.br", "fst.br", "g12.br", "geo.br",
            "ggf.br", "jor.br", "lel.br", "mat.br", "med.br", "mus.br", "not.br", "ntr.br", "odo.br", "ppg.br", "pro.br", "psc.br",
            "psi.br", "qsl.br", "rec.br", "slg.br", "srv.br", "tmp.br", "trd.br", "tur.br", "tv.br", "vet.br", "zlg.br",
            // Russia
            "com.ru", "net.ru", "org.ru", "edu.ru", "gov.ru", "int.ru", "mil.ru", "spb.ru", "msk.ru",
            // China
            "com.cn", "net.cn", "org.cn", "edu.cn", "gov.cn", "mil.cn", "ac.cn", "ah.cn", "bj.cn", "cq.cn", "fj.cn", "gd.cn", "gs.cn",
            "gz.cn", "gx.cn", "ha.cn", "hb.cn", "he.cn", "hi.cn", "hk.cn", "hl.cn", "hn.cn", "jl.cn", "js.cn", "jx.cn", "ln.cn", "mo.cn",
            "nm.cn", "nx.cn", "qh.cn", "sc.cn", "sd.cn", "sh.cn", "sn.cn", "sx.cn", "tj.cn", "tw.cn", "xj.cn", "xz.cn", "yn.cn", "zj.cn",
            // Mexico
            "com.mx", "net.mx", "org.mx", "edu.mx", "gob.mx",
            // Argentina
            "com.ar", "net.ar", "org.ar", "edu.ar", "gov.ar", "mil.ar", "int.ar",
            // Chile
            "com.cl", "net.cl", "org.cl", "edu.cl", "gov.cl", "mil.cl",
            // Colombia
            "com.co", "net.co", "org.co", "edu.co", "gov.co", "mil.co", "nom.co",
            // Venezuela
            "com.ve", "net.ve", "org.ve", "edu.ve", "gov.ve", "mil.ve", "web.ve",
            // Peru
            "com.pe", "net.pe", "org.pe", "edu.pe", "gob.pe", "mil.pe", "nom.pe",
            // Ecuador
            "com.ec", "net.ec", "org.ec", "edu.ec", "gov.ec", "mil.ec", "med.ec", "fin.ec", "pro.ec", "info.ec",
            // Europe
            "co.at", "or.at", "ac.at", "gv.at", "priv.at",
            "co.be", "ac.be",
            "co.dk", "ac.dk",
            "co.il", "net.il", "org.il", "ac.il", "gov.il", "idf.il", "k12.il", "muni.il",
            "co.no", "ac.no", "priv.no",
            "co.pl", "net.pl", "org.pl", "edu.pl", "gov.pl", "mil.pl", "nom.pl", "com.pl",
            "co.th", "net.th", "org.th", "edu.th", "gov.th", "mil.th", "ac.th", "in.th",
            "co.kr", "net.kr", "org.kr", "edu.kr", "gov.kr", "mil.kr", "ac.kr", "go.kr", "ne.kr", "or.kr", "pe.kr", "re.kr", "seoul.kr",
            "kyonggi.kr",
            // Others
            "co.id", "net.id", "org.id", "edu.id", "gov.id", "mil.id", "web.id", "ac.id", "sch.id",
            "co.ma", "net.ma", "org.ma", "edu.ma", "gov.ma", "ac.ma", "press.ma",
            "co.ke", "net.ke", "org.ke", "edu.ke", "gov.ke", "ac.ke", "go.ke", "info.ke", "me.ke", "mobi.ke", "sc.ke",
            "co.ug", "net.ug", "org.ug", "edu.ug", "gov.ug", "ac.ug", "sc.ug", "go.ug", "ne.ug", "or.ug",
            "co.tz", "net.tz", "org.tz", "edu.tz", "gov.tz", "ac.tz", "go.tz", "hotel.tz", "info.tz", "me.tz", "mil.tz", "mobi.tz",
            "ne.tz", "or.tz", "sc.tz", "tv.tz",
        )

        // Check if the last two parts form a known two-level TLD
        if (parts.size >= 3) {
            val lastTwoParts = parts.takeLast(2).joinToString(".")
            if (twoLevelTlds.contains(lastTwoParts)) {
                // Take the last three parts for two-level TLDs
                return parts.takeLast(3).joinToString(".")
            }
        }

        // Default to last two parts for regular TLDs
        return if (parts.size >= 2) {
            parts.takeLast(2).joinToString(".")
        } else {
            domain
        }
    }

    /**
     * Check if two domains match, supporting partial matches.
     * @param domain1 First domain
     * @param domain2 Second domain
     * @return True if domains match (including partial matches)
     */
    private fun domainsMatch(domain1: String, domain2: String): Boolean {
        val d1 = extractDomain(domain1)
        val d2 = extractDomain(domain2)

        // If either extracted domain is empty, early return false.
        if (d1.isEmpty() || d2.isEmpty()) return false

        // Exact match
        if (d1 == d2) return true

        // Check if one domain contains the other (for subdomain matching)
        if (d1.contains(d2) || d2.contains(d1)) return true

        // Check root domain match
        val d1Root = extractRootDomain(d1)
        val d2Root = extractRootDomain(d2)

        return d1Root == d2Root
    }

    /**
     * Extract meaningful words from text, removing punctuation and filtering stop words.
     * @param text Text to extract words from
     * @return List of filtered words
     */
    private fun extractWords(text: String): List<String> {
        if (text.isBlank()) {
            return emptyList()
        }

        return text.lowercase()
            // Replace common separators and punctuation with spaces (including dots)
            .replace(Regex("[|,;:\\-–—/\\\\()\\[\\]{}'\" ~!@#$%^&*+=<>?.]"), " ")
            .split(Regex("\\s+"))
            .filter { word ->
                word.length > 3 // Filter out short words
            }
    }

    /**
     * Filter credentials based on search text with anti-phishing protection.
     * @param credentials List of credentials to filter
     * @param searchText Search term (app info, URL, etc.)
     * @return Filtered list of credentials
     *
     * **Security Note**: When searching with a URL, text search fallback only applies to
     * credentials with no service URL defined. This prevents phishing attacks where a
     * malicious site might match credentials intended for the legitimate site.
     */
    fun filterCredentialsByAppInfo(
        credentials: List<Credential>,
        searchText: String,
    ): List<Credential> {
        if (searchText.isEmpty()) {
            return credentials
        }

        val matches = mutableSetOf<Credential>()

        val searchDomain = extractDomain(searchText)

        // Try to parse as Android package name first.
        if (isAndroidPackageName(searchText)) {
            // Is most likely android package name, do a simple exact match search on URL field
            credentials.forEach { credential ->
                val serviceUrl = credential.service.url
                if (!serviceUrl.isNullOrEmpty()) {
                    if (searchText == serviceUrl) {
                        matches.add(credential)
                    }
                }
            }
        }

        // If android package name results in matches, return them immediately.
        if (matches.isNotEmpty()) {
            return matches.toList()
        }

        // Try URL second
        if (searchDomain.isNotEmpty()) {
            // Check for domain matches with priority
            credentials.forEach { credential ->
                val serviceUrl = credential.service.url
                if (!serviceUrl.isNullOrEmpty()) {
                    if (domainsMatch(searchText, serviceUrl)) {
                        matches.add(credential)
                    }
                }
            }

            // SECURITY: If no domain matches found, only search text in credentials with NO service URL
            // This prevents phishing attacks by ensuring URL-based credentials only match their domains
            if (matches.isEmpty()) {
                val domainParts = searchDomain.split(".")
                val domainWithoutExtension = domainParts.firstOrNull()?.lowercase() ?: searchDomain.lowercase()

                val nameMatches = credentials.filter { credential ->
                    if (!credential.service.url.isNullOrEmpty()) {
                        return@filter false
                    }

                    val serviceNameMatch = credential.service.name?.lowercase()?.contains(domainWithoutExtension) ?: false
                    val notesMatch = credential.notes?.lowercase()?.contains(domainWithoutExtension) ?: false
                    serviceNameMatch || notesMatch
                }
                matches.addAll(nameMatches)
            }

            return matches.toList()
        } else {
            // Non-URL fallback: Extract words from search text for better matching
            val searchWords = extractWords(searchText)

            if (searchWords.isEmpty()) {
                // If no meaningful words after extraction, fall back to simple contains
                val lowercasedSearch = searchText.lowercase()
                return credentials.filter { credential ->
                    (credential.service.name?.lowercase()?.contains(lowercasedSearch) ?: false) ||
                        (credential.username?.lowercase()?.contains(lowercasedSearch) ?: false) ||
                        (credential.notes?.lowercase()?.contains(lowercasedSearch) ?: false)
                }
            }

            // Match using extracted words
            return credentials.filter { credential ->
                val serviceNameWords = credential.service.name?.let { extractWords(it) } ?: emptyList()
                val usernameWords = credential.username?.let { extractWords(it) } ?: emptyList()
                val notesWords = credential.notes?.let { extractWords(it) } ?: emptyList()

                // Check if any search word matches any credential word exactly
                searchWords.any { searchWord ->
                    serviceNameWords.contains(searchWord) ||
                        usernameWords.contains(searchWord) ||
                        notesWords.contains(searchWord)
                }
            }
        }
    }
}
