import Foundation

/// Normalizes service URLs supplied by the iOS autofill subsystem before
/// we store them on a credential or compare them to existing credential URLs.
public enum AutofillUrlNormalizer {
    /// Regex matching any `<scheme>://` prefix (RFC 3986 scheme syntax).
    /// Used so we don't accidentally prepend `https://` onto strings that
    /// already have a non-http scheme like `chrome://` or `app://`.
    private static let schemePrefixPattern = "^[a-zA-Z][a-zA-Z0-9+.-]*://"

    /// Normalize a service URL/identifier for storage and comparison.
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
        return components.url?.absoluteString ?? withScheme
    }
}
