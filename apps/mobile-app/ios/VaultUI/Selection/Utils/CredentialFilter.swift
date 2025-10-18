import Foundation
import VaultModels

/// Utility class for filtering credentials based on search text.
/// This class contains the core filtering logic used by both UI and tests for consistency.
public class CredentialFilter {

    /// Extract domain from URL, handling both full URLs and partial domains.
    /// - Parameter urlString: URL or domain string
    /// - Returns: Normalized domain without protocol or www, or empty string if not a valid URL/domain
    private static func extractDomain(from urlString: String) -> String {
        guard !urlString.isEmpty else { return "" }

        var domain = urlString.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

        // Check if it starts with a protocol
        let hasProtocol = domain.hasPrefix("http://") || domain.hasPrefix("https://")

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
    /// - Parameters:
    ///   - credentials: List of credentials to filter
    ///   - searchText: Search term (app info, URL, etc.)
    /// - Returns: Filtered list of credentials
    ///
    /// **Security Note**: When searching with a URL, text search fallback only applies to
    /// credentials with no service URL defined. This prevents phishing attacks where a
    /// malicious site might match credentials intended for the legitimate site.
    public static func filterCredentials(_ credentials: [Credential], searchText: String) -> [Credential] {
        if searchText.isEmpty {
            return credentials
        }

        // Try to parse as URL first
        let searchDomain = extractDomain(from: searchText)

        if !searchDomain.isEmpty {
            var matches: Set<Credential> = []

            // Check for domain matches with priority
            credentials.forEach { credential in
                guard let serviceUrl = credential.service.url, !serviceUrl.isEmpty else { return }

                if domainsMatch(searchText, serviceUrl) {
                    matches.insert(credential)
                }
            }

            // SECURITY: If no domain matches found, only search text in credentials with NO service URL
            // This prevents phishing attacks by ensuring URL-based credentials only match their domains
            if matches.isEmpty {
                let domainParts = searchDomain.components(separatedBy: ".")
                let domainWithoutExtension = domainParts.first?.lowercased() ?? searchDomain.lowercased()

                let nameMatches = credentials.filter { credential in
                    // CRITICAL: Only search in credentials that have no service URL defined
                    guard credential.service.url?.isEmpty != false else { return false }

                    let serviceNameMatch = credential.service.name?.lowercased().contains(domainWithoutExtension) ?? false
                    let notesMatch = credential.notes?.lowercased().contains(domainWithoutExtension) ?? false
                    return serviceNameMatch || notesMatch
                }
                matches.formUnion(nameMatches)
            }

            return Array(matches)
        } else {
            // Non-URL fallback: Extract words from search text for better matching
            let searchWords = extractWords(from: searchText)

            if searchWords.isEmpty {
                // If no meaningful words after extraction, fall back to simple contains
                let lowercasedSearch = searchText.lowercased()
                return credentials.filter { credential in
                    (credential.service.name?.lowercased().contains(lowercasedSearch) ?? false) ||
                        (credential.username?.lowercased().contains(lowercasedSearch) ?? false) ||
                        (credential.notes?.lowercased().contains(lowercasedSearch) ?? false)
                }
            }

            // Match using extracted words
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
}
