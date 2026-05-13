import Foundation
import RustCoreFramework

/// Normalizes service URLs supplied by the iOS autofill subsystem before
/// we store them on a credential or compare them to existing credential URLs.
public enum AutofillUrlNormalizer {
    /// Regex matching any `<scheme>://` prefix (RFC 3986 scheme syntax).
    /// Used so we don't accidentally prepend `https://` onto strings that
    /// already have a non-http scheme like `chrome://` or `app://`.
    private static let schemePrefixPattern = "^[a-zA-Z][a-zA-Z0-9+.-]*://"

    /// Normalize a service URL/identifier for storage and display.
    /// - Parameter raw: The URL or bare domain as supplied by iOS, possibly
    ///   already lowercased and with a trailing path/query/fragment.
    /// - Returns: A canonical URL string (`https://host[/path]`) suitable for
    ///   storage. Returns the trimmed input unchanged if it's empty or if
    ///   `URLComponents` can't parse the result.
    public static func normalize(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return trimmed
        }

        // Prepend https:// only when there isn't already a scheme. We test for
        // any scheme (not just http/https) so values like `chrome://newtab`
        // pass through unchanged rather than becoming `https://chrome://newtab`.
        let hasScheme = trimmed.range(of: schemePrefixPattern, options: .regularExpression) != nil
        let withScheme = hasScheme ? trimmed : "https://\(trimmed)"

        guard var components = URLComponents(string: withScheme) else {
            return withScheme
        }
        components.query = nil
        components.fragment = nil
        let rebuilt = components.url?.absoluteString ?? withScheme
        // Drop a trailing slash so `https://host/` and `https://host` normalize
        // to the same string..
        if rebuilt.hasSuffix("/") && rebuilt.count > 1 {
            return String(rebuilt.dropLast())
        }
        return rebuilt
    }

    /// Comparison key used to decide whether a credential is already linked to
    /// a given service URL. Reduces a URL to its host (subdomain + domain),
    /// stripping scheme, `www.`, path, query, fragment, and trailing slash, so
    /// that `https://my.base.com/`, `https://my.base.com`, and
    /// `http://www.my.base.com/login?x=1` all compare equal.
    ///
    /// Falls back to the lowercased, trimmed input when host extraction yields
    /// no domain (e.g. iOS app bundle identifiers like `com.example.app`,
    /// which the Rust extractor intentionally rejects as reversed-TLD package
    /// names). For those identifiers an exact-string compare is the only safe
    /// option.
    public static func comparisonKey(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else {
            return trimmed
        }
        let domain = extractDomain(url: trimmed)
        return domain.isEmpty ? trimmed : domain
    }
}
