import Foundation
import VaultModels

/// Utility class for matching credentials against app/website information for autofill.
/// This implementation follows the unified filtering algorithm specification defined in
/// docs/CREDENTIAL_FILTERING_SPEC.md for cross-platform consistency with Android and Browser Extension.
///
/// Algorithm Structure (Priority Order with Early Returns):
/// 1. PRIORITY 1: App Package Name Exact Match (e.g., com.coolblue.app)
/// 2. PRIORITY 2: URL Domain Matching (exact, subdomain, root domain)
/// 3. PRIORITY 3: Service Name Fallback (only for credentials without URLs - anti-phishing)
/// 4. PRIORITY 4: Text/Word Matching (non-URL search)
public class CredentialMatcher {

    /// Common top-level domains (TLDs) used for app package name detection.
    /// When a search string starts with one of these TLDs followed by a dot (e.g., "com.coolblue.app"),
    /// it's identified as a reversed domain name (app package name) rather than a regular URL.
    /// This prevents false matches and enables proper package name handling.
    private static let commonTlds: Set<String> = [
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
        "blog", "news", "media", "tv", "video", "music", "pro", "info", "biz", "name"
    ]

    /// Check if a string is likely an app package name (reversed domain).
    /// Package names start with TLD followed by dot (e.g., "com.example", "nl.app").
    /// - Parameter text: The text to check
    /// - Returns: True if it looks like an app package name
    private static func isAppPackageName(_ text: String) -> Bool {
        // Must contain a dot
        guard text.contains(".") else { return false }

        // Must not have protocol
        if text.hasPrefix("http://") || text.hasPrefix("https://") {
            return false
        }

        // Extract first part before first dot
        let firstPart = text.components(separatedBy: ".").first?.lowercased() ?? ""

        // Check if first part is a common TLD - indicates reversed domain (package name)
        return commonTlds.contains(firstPart)
    }

    /// Extract domain from URL, handling both full URLs and partial domains.
    /// - Parameter urlString: URL or domain string
    /// - Returns: Normalized domain without protocol or www, or empty string if not a valid URL/domain
    private static func extractDomain(from urlString: String) -> String {
        guard !urlString.isEmpty else { return "" }

        var domain = urlString.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

        // Check if it starts with a protocol
        let hasProtocol = domain.hasPrefix("http://") || domain.hasPrefix("https://")

        // If no protocol and starts with TLD + dot, it's likely an app package name
        // Return empty string to indicate that domain extraction has failed for this string
        if !hasProtocol && isAppPackageName(domain) {
            return ""
        }

        // Remove protocol if present
        if hasProtocol {
            domain = domain.replacingOccurrences(of: "https://", with: "")
            domain = domain.replacingOccurrences(of: "http://", with: "")
        }

        // Remove www. prefix
        domain = domain.replacingOccurrences(of: "www.", with: "")

        // Remove path, query, and fragment
        if let firstSlash = domain.firstIndex(of: "/") {
            domain = String(domain[..<firstSlash])
        }
        if let firstQuestion = domain.firstIndex(of: "?") {
            domain = String(domain[..<firstQuestion])
        }
        if let firstHash = domain.firstIndex(of: "#") {
            domain = String(domain[..<firstHash])
        }

        // Basic domain validation - must contain at least one dot and valid characters
        do {
            let domainRegex = try NSRegularExpression(pattern: "^[a-z0-9.-]+$")

            let range = NSRange(location: 0, length: domain.utf16.count)
            if !domain.contains(".") || domainRegex.firstMatch(in: domain, options: [], range: range) == nil {
                return ""
            }
        } catch {
            return ""
        }

        // Ensure we have a valid domain structure
        if domain.isEmpty || domain.hasPrefix(".") || domain.hasSuffix(".") || domain.contains("..") {
            return ""
        }

        return domain
    }

    /// Extract root domain from a domain string.
    /// - Parameter domain: Domain string
    /// - Returns: Root domain (e.g., "sub.example.com" -> "example.com", "sub.example.com.au" -> "example.com.au", "sub.example.co.uk" -> "example.co.uk")
    private static func extractRootDomain(from domain: String) -> String {
        let parts = domain.components(separatedBy: ".")
        guard parts.count >= 2 else { return domain }

        // Common two-level public TLDs
        let twoLevelTlds: Set<String> = [
            // Australia
            "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
            // United Kingdom
            "co.uk", "org.uk", "net.uk", "ac.uk", "gov.uk", "plc.uk", "ltd.uk", "me.uk",
            // Canada
            "co.ca", "net.ca", "org.ca", "gc.ca", "ab.ca", "bc.ca", "mb.ca", "nb.ca", "nf.ca", "nl.ca", "ns.ca", "nt.ca", "nu.ca", "on.ca", "pe.ca", "qc.ca", "sk.ca", "yk.ca",
            // India
            "co.in", "net.in", "org.in", "edu.in", "gov.in", "ac.in", "res.in", "gen.in", "firm.in", "ind.in",
            // Japan
            "co.jp", "ne.jp", "or.jp", "ac.jp", "ad.jp", "ed.jp", "go.jp", "gr.jp", "lg.jp",
            // South Africa
            "co.za", "net.za", "org.za", "edu.za", "gov.za", "ac.za", "web.za",
            // New Zealand
            "co.nz", "net.nz", "org.nz", "edu.nz", "govt.nz", "ac.nz", "geek.nz", "gen.nz", "kiwi.nz", "maori.nz", "mil.nz", "school.nz",
            // Brazil
            "com.br", "net.br", "org.br", "edu.br", "gov.br", "mil.br", "art.br", "etc.br", "adv.br", "arq.br", "bio.br", "cim.br", "cng.br", "cnt.br", "ecn.br", "eng.br",
            "esp.br", "eti.br", "far.br", "fnd.br", "fot.br", "fst.br", "g12.br", "geo.br", "ggf.br", "jor.br", "lel.br", "mat.br", "med.br", "mus.br", "not.br", "ntr.br",
            "odo.br", "ppg.br", "pro.br", "psc.br", "psi.br", "qsl.br", "rec.br", "slg.br", "srv.br", "tmp.br", "trd.br", "tur.br", "tv.br", "vet.br", "zlg.br",
            // Russia
            "com.ru", "net.ru", "org.ru", "edu.ru", "gov.ru", "int.ru", "mil.ru", "spb.ru", "msk.ru",
            // China
            "com.cn", "net.cn", "org.cn", "edu.cn", "gov.cn", "mil.cn", "ac.cn", "ah.cn", "bj.cn", "cq.cn", "fj.cn", "gd.cn", "gs.cn", "gz.cn", "gx.cn", "ha.cn", "hb.cn",
            "he.cn", "hi.cn", "hk.cn", "hl.cn", "hn.cn", "jl.cn", "js.cn", "jx.cn", "ln.cn", "mo.cn", "nm.cn", "nx.cn", "qh.cn", "sc.cn", "sd.cn", "sh.cn", "sn.cn",
            "sx.cn", "tj.cn", "tw.cn", "xj.cn", "xz.cn", "yn.cn", "zj.cn",
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
            "co.kr", "net.kr", "org.kr", "edu.kr", "gov.kr", "mil.kr", "ac.kr", "go.kr", "ne.kr", "or.kr", "pe.kr", "re.kr", "seoul.kr", "kyonggi.kr",
            // Others
            "co.id", "net.id", "org.id", "edu.id", "gov.id", "mil.id", "web.id", "ac.id", "sch.id",
            "co.ma", "net.ma", "org.ma", "edu.ma", "gov.ma", "ac.ma", "press.ma",
            "co.ke", "net.ke", "org.ke", "edu.ke", "gov.ke", "ac.ke", "go.ke", "info.ke", "me.ke", "mobi.ke", "sc.ke",
            "co.ug", "net.ug", "org.ug", "edu.ug", "gov.ug", "ac.ug", "sc.ug", "go.ug", "ne.ug", "or.ug",
            "co.tz", "net.tz", "org.tz", "edu.tz", "gov.tz", "ac.tz", "go.tz", "hotel.tz", "info.tz", "me.tz", "mil.tz", "mobi.tz", "ne.tz", "or.tz", "sc.tz", "tv.tz"
        ]

        // Check if the last two parts form a known two-level TLD
        if parts.count >= 3 {
            let lastTwoParts = parts.suffix(2).joined(separator: ".")
            if twoLevelTlds.contains(lastTwoParts) {
                // Take the last three parts for two-level TLDs
                return parts.suffix(3).joined(separator: ".")
            }
        }

        // Default to last two parts for regular TLDs
        if parts.count >= 2 {
            return parts.suffix(2).joined(separator: ".")
        }

        return domain
    }

    /// Check if two domains match, supporting partial matches.
    /// - Parameters:
    ///   - domain1: First domain
    ///   - domain2: Second domain
    /// - Returns: True if domains match (including partial matches)
    private static func domainsMatch(_ domain1: String, _ domain2: String) -> Bool {
        let d1 = extractDomain(from: domain1)
        let d2 = extractDomain(from: domain2)

        // Exact match
        if d1 == d2 { return true }

        // Check if one domain contains the other (for subdomain matching)
        if d1.contains(d2) || d2.contains(d1) { return true }

        // Check root domain match
        let d1Root = extractRootDomain(from: d1)
        let d2Root = extractRootDomain(from: d2)

        return d1Root == d2Root
    }

    /// Extract meaningful words from text, removing punctuation and filtering stop words.
    /// - Parameter text: Text to extract words from
    /// - Returns: Array of filtered words
    private static func extractWords(from text: String) -> [String] {
        guard !text.isEmpty else { return [] }

        let lowercased = text.lowercased()

        // Replace common separators and punctuation with spaces
        let punctuationPattern = "[|,;:\\-–—/\\\\()\\[\\]{}'\" ~!@#$%^&*+=<>?]"
        let withoutPunctuation = lowercased.replacingOccurrences(
            of: punctuationPattern,
            with: " ",
            options: .regularExpression
        )

        // Split on whitespace and filter
        return withoutPunctuation
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { word in
                word.count > 3  // Filter out short words
            }
    }

    /// Filter credentials based on search text with anti-phishing protection.
    ///
    /// This method follows a strict priority-based algorithm with early returns:
    /// 1. PRIORITY 1: App Package Name Exact Match (highest priority)
    /// 2. PRIORITY 2: URL Domain Matching
    /// 3. PRIORITY 3: Service Name Fallback (anti-phishing protection)
    /// 4. PRIORITY 4: Text/Word Matching (lowest priority)
    ///
    /// - Parameters:
    ///   - credentials: List of credentials to filter
    ///   - searchText: Search term (app package name, URL, or text)
    /// - Returns: Filtered list of credentials
    ///
    /// **Security Note**: Priority 3 only searches credentials with no service URL defined.
    /// This prevents phishing attacks where a malicious site might match credentials
    /// intended for a legitimate site.
    public static func filterCredentials(_ credentials: [Credential], searchText: String) -> [Credential] {
        // Early return for empty search
        if searchText.isEmpty {
            return credentials
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        // PRIORITY 1: App Package Name Exact Match
        // Check if search text is an app package name (e.g., com.coolblue.app)
        // ═══════════════════════════════════════════════════════════════════════════════
        if isAppPackageName(searchText) {
            // Perform exact string match on service URL field
            let packageMatches = credentials.filter { credential in
                guard let serviceUrl = credential.service.url, !serviceUrl.isEmpty else { return false }
                return searchText == serviceUrl
            }

            // EARLY RETURN if matches found
            if !packageMatches.isEmpty {
                return packageMatches
            }
            // If no matches found, continue to next priority
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        // PRIORITY 2: URL Domain Matching
        // Try to extract domain from search text
        // ═══════════════════════════════════════════════════════════════════════════════
        let searchDomain = extractDomain(from: searchText)

        if !searchDomain.isEmpty {
            // Valid domain extracted - perform domain matching
            let domainMatches = credentials.filter { credential in
                guard let serviceUrl = credential.service.url, !serviceUrl.isEmpty else { return false }
                return domainsMatch(searchText, serviceUrl)
            }

            // EARLY RETURN if matches found
            if !domainMatches.isEmpty {
                return domainMatches
            }

            // ═══════════════════════════════════════════════════════════════════════════
            // PRIORITY 3: Service Name Fallback (Anti-Phishing Protection)
            // No domain matches found - search in service names
            // CRITICAL: Only search credentials with NO service URL defined
            // ═══════════════════════════════════════════════════════════════════════════
            let domainParts = searchDomain.components(separatedBy: ".")
            let domainWithoutExtension = domainParts.first?.lowercased() ?? searchDomain.lowercased()

            let nameMatches = credentials.filter { credential in
                // SECURITY: Skip credentials that have a URL defined
                guard credential.service.url?.isEmpty != false else { return false }

                // Search in ServiceName and Notes using substring contains
                let serviceNameMatch = credential.service.name?.lowercased().contains(domainWithoutExtension) ?? false
                let notesMatch = credential.notes?.lowercased().contains(domainWithoutExtension) ?? false
                return serviceNameMatch || notesMatch
            }

            // Return matches from Priority 3 (don't continue to Priority 4)
            return nameMatches
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        // PRIORITY 4: Text/Word Matching
        // Search text is not a URL or package name - perform text-based matching
        // ═══════════════════════════════════════════════════════════════════════════════
        let searchWords = extractWords(from: searchText)

        if searchWords.isEmpty {
            // If no meaningful words after extraction, fall back to simple substring contains
            let lowercasedSearch = searchText.lowercased()
            return credentials.filter { credential in
                (credential.service.name?.lowercased().contains(lowercasedSearch) ?? false) ||
                    (credential.username?.lowercased().contains(lowercasedSearch) ?? false) ||
                    (credential.notes?.lowercased().contains(lowercasedSearch) ?? false)
            }
        }

        // Match using extracted words - exact word matching only
        return credentials.filter { credential in
            let serviceNameWords = credential.service.name.map { extractWords(from: $0) } ?? []
            let usernameWords = credential.username.map { extractWords(from: $0) } ?? []
            let notesWords = credential.notes.map { extractWords(from: $0) } ?? []

            // Check if any search word matches any credential word exactly
            return searchWords.contains { searchWord in
                serviceNameWords.contains(searchWord) ||
                    usernameWords.contains(searchWord) ||
                    notesWords.contains(searchWord)
            }
        }
    }
}
