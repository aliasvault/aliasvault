//! Domain extraction and matching utilities.

use std::collections::HashSet;
use std::sync::LazyLock;

use super::public_suffix;

/// Common top-level domains (TLDs) used for app package name detection.
/// When a search string starts with one of these TLDs followed by a dot (e.g., "com.coolblue.app"),
/// it's identified as a reversed domain name (app package name) rather than a regular URL.
static COMMON_TLDS: &[&str] = &[
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
];

/// [`COMMON_TLDS`] as a set for constant-time lookup.
static COMMON_TLD_SET: LazyLock<HashSet<&'static str>> = LazyLock::new(|| COMMON_TLDS.iter().copied().collect());

/// Check if a string is likely an app package name (reversed domain).
/// Package names start with TLD followed by dot (e.g., "com.example", "nl.app").
pub fn is_app_package_name(text: &str) -> bool {
    if !text.contains('.') || text.starts_with("http://") || text.starts_with("https://") {
        return false;
    }

    // A first label that is a TLD indicates a reversed domain (package name).
    let first_part = text.split('.').next().unwrap_or("").to_lowercase();
    COMMON_TLD_SET.contains(first_part.as_str())
}

/// Split a URL into its scheme, authority (host and port) and the path/query/fragment remainder.
///
/// The scheme is returned as written; use [`is_web_scheme`] to test it. A host followed by a
/// numeric port ("example.com:8080") is not mistaken for a scheme.
pub(crate) fn split_url(url: &str) -> (Option<&str>, &str, &str) {
    let (scheme, after_scheme) = match url.split_once(':') {
        Some((scheme, rest)) if is_scheme(scheme) && !is_port(rest) => (Some(scheme), rest.strip_prefix("//").unwrap_or(rest)),
        _ => (None, url),
    };

    let authority_end = after_scheme.find(['/', '?', '#']).unwrap_or(after_scheme.len());
    let (authority, rest) = after_scheme.split_at(authority_end);
    (scheme, authority, rest)
}

/// Whether the text is `http` or `https`, in any casing.
pub(crate) fn is_web_scheme(scheme: &str) -> bool {
    scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https")
}

/// Whether the text is shaped like a URL scheme (RFC 3986: a letter, then letters, digits, `+`, `-` or `.`).
fn is_scheme(text: &str) -> bool {
    text.starts_with(|c: char| c.is_ascii_alphabetic()) && text.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
}

/// Whether the text after a colon is a bare port number, up to the first path, query or fragment.
fn is_port(rest: &str) -> bool {
    let port = &rest[..rest.find(['/', '?', '#']).unwrap_or(rest.len())];
    !port.is_empty() && port.chars().all(|c| c.is_ascii_digit())
}

/// Result of domain extraction containing both the domain and optional port.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct DomainWithPort {
    pub domain: String,
    pub port: Option<String>,
}

impl DomainWithPort {
    /// Returns the domain with port if present (e.g., "example.com:8080")
    pub fn with_port(&self) -> String {
        match &self.port {
            Some(p) => format!("{}:{}", self.domain, p),
            None => self.domain.clone(),
        }
    }
}

/// Extract domain and port from URL, handling both full URLs and partial domains.
/// Returns DomainWithPort with empty domain if not a valid URL/domain.
pub fn extract_domain_with_port(url: &str) -> DomainWithPort {
    let lowered = url.trim().to_lowercase();
    let (scheme, authority, _) = split_url(&lowered);

    // A web scheme is what allows single-word hostnames like "http://plex" or "https://nas",
    // common in self-hosted setups. Any other scheme names something that is not a website.
    let has_protocol = match scheme {
        Some(scheme) if is_web_scheme(scheme) => true,
        Some(_) => return DomainWithPort::default(),
        None => false,
    };

    // Without a scheme, text starting with a TLD and a dot is an app package name, not a domain.
    if !has_protocol && is_app_package_name(authority) {
        return DomainWithPort::default();
    }

    let host = authority.strip_prefix("www.").unwrap_or(authority);
    let (domain, port) = match host.split_once(':') {
        Some((domain, port)) if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) => (domain, Some(port.to_string())),
        Some((domain, _)) => (domain, None),
        None => (host, None),
    };

    // Without a scheme, require at least one dot to distinguish a hostname from random text.
    if domain.is_empty() || (!domain.contains('.') && !has_protocol) {
        return DomainWithPort::default();
    }

    let valid_chars = domain.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    let valid_structure = !domain.starts_with('.') && !domain.ends_with('.') && !domain.contains("..");
    if !valid_chars || !valid_structure {
        return DomainWithPort::default();
    }

    DomainWithPort { domain: domain.to_string(), port }
}

/// Extract domain from URL, handling both full URLs and partial domains.
/// Returns empty string if not a valid URL/domain.
/// Note: This strips port numbers. Use extract_domain_with_port() to preserve port info.
pub fn extract_domain(url: &str) -> String {
    extract_domain_with_port(url).domain
}

/// Check if a host string is an IP address literal (IPv4 or IPv6, optionally bracketed).
/// IP addresses have no domain hierarchy, so they must never be reduced to a "root domain".
fn is_ip_literal(host: &str) -> bool {
    let bare = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(host);
    bare.parse::<std::net::IpAddr>().is_ok()
}

/// Extract the root (registrable) domain from a domain string, per the Public Suffix List.
/// E.g., "sub.example.com" -> "example.com"
/// E.g., "sub.example.co.uk" -> "example.co.uk"
/// E.g., "preview.myproject.vercel.app" -> "myproject.vercel.app"
/// A domain that is a public suffix itself ("github.io", "localhost") and IP address literals are returned
/// unchanged: "192.168.1.5" must not become "1.5".
pub fn extract_root_domain(domain: &str) -> String {
    if is_ip_literal(domain) {
        return domain.to_string();
    }

    public_suffix::registrable_domain(domain).unwrap_or(domain).to_string()
}

/// Check if two domains match: the same domain, or the same root domain (so subdomains match their parent).
/// Note: Both parameters should be pre-extracted domains (without protocol, www, path, etc.)
///
/// Two hosts under a shared public suffix ("victim.vercel.app" and "attacker.vercel.app") have different root
/// domains and never match, and neither do a public suffix and a host under it ("vercel.app" and
/// "victim.vercel.app"): the suffix has no registrable domain to share.
pub fn domains_match(domain1: &str, domain2: &str) -> bool {
    if domain1.is_empty() || domain2.is_empty() {
        return false;
    }

    // IP address literals have no subdomain structure: only the exact same address matches.
    // Without this guard, "192.168.1.5" and "10.0.1.5" would both reduce to root "1.5" and match.
    if is_ip_literal(domain1) || is_ip_literal(domain2) {
        return domain1 == domain2;
    }

    if domain1 == domain2 {
        return true;
    }

    match (public_suffix::registrable_domain(domain1), public_suffix::registrable_domain(domain2)) {
        (Some(root1), Some(root2)) => root1 == root2,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_app_package_name() {
        assert!(is_app_package_name("com.coolblue.app"));
        assert!(is_app_package_name("nl.marktplaats.android"));
        assert!(is_app_package_name("org.example.app"));

        assert!(!is_app_package_name("https://example.com"));
        assert!(!is_app_package_name("example.com"));
        assert!(!is_app_package_name("coolblue.nl"));
        assert!(!is_app_package_name("nodot"));
    }

    #[test]
    fn test_extract_domain() {
        assert_eq!(extract_domain("https://www.example.com/path"), "example.com");
        assert_eq!(extract_domain("http://example.com"), "example.com");
        assert_eq!(extract_domain("example.com"), "example.com");
        assert_eq!(extract_domain("www.example.com"), "example.com");
        assert_eq!(extract_domain("https://example.com?query=1"), "example.com");
        assert_eq!(extract_domain("https://example.com#fragment"), "example.com");

        // Package names should return empty
        assert_eq!(extract_domain("com.coolblue.app"), "");

        // Invalid domains
        assert_eq!(extract_domain(""), "");
        assert_eq!(extract_domain("nodot"), "");

        // Single-word hostnames WITH protocol should be supported
        // (common in self-hosted/homelab setups with local DNS or /etc/hosts)
        assert_eq!(extract_domain("http://localhost"), "localhost");
        assert_eq!(extract_domain("https://localhost"), "localhost");
        assert_eq!(extract_domain("http://localhost/path"), "localhost");
        assert_eq!(extract_domain("http://localhost?query=1"), "localhost");
        assert_eq!(extract_domain("http://plex"), "plex");
        assert_eq!(extract_domain("https://nas"), "nas");
        assert_eq!(extract_domain("http://router"), "router");
        assert_eq!(extract_domain("http://homeassistant"), "homeassistant");
        assert_eq!(extract_domain("http://pihole/admin"), "pihole");

        // Single-word hostnames without protocol should not be accepted
        // (to avoid matching random text as domains)
        assert_eq!(extract_domain("localhost"), "");
        assert_eq!(extract_domain("plex"), "");
        assert_eq!(extract_domain("randomword"), "");
    }

    #[test]
    fn test_extract_domain_single_word_hostname_with_port() {
        // Single-word hostnames with port (common for self-hosted services)
        assert_eq!(extract_domain("http://localhost:8080"), "localhost");
        assert_eq!(extract_domain("http://localhost:81"), "localhost");
        assert_eq!(extract_domain("http://localhost:3000/path"), "localhost");
        assert_eq!(extract_domain("http://plex:32400"), "plex");
        assert_eq!(extract_domain("https://nas:5001"), "nas");
        assert_eq!(extract_domain("http://router:8080/admin"), "router");

        // Without protocol - should not work (could be ambiguous)
        assert_eq!(extract_domain("localhost:8080"), "");
        assert_eq!(extract_domain("plex:32400"), "");

        // Test DomainWithPort struct with localhost
        let result = extract_domain_with_port("http://localhost:81");
        assert_eq!(result.domain, "localhost");
        assert_eq!(result.port, Some("81".to_string()));
        assert_eq!(result.with_port(), "localhost:81");

        let result = extract_domain_with_port("http://localhost:8080/path");
        assert_eq!(result.domain, "localhost");
        assert_eq!(result.port, Some("8080".to_string()));

        let result = extract_domain_with_port("http://localhost/path");
        assert_eq!(result.domain, "localhost");
        assert_eq!(result.port, None);

        // Test with other single-word hostnames
        let result = extract_domain_with_port("http://plex:32400");
        assert_eq!(result.domain, "plex");
        assert_eq!(result.port, Some("32400".to_string()));

        let result = extract_domain_with_port("https://nas:5001/files");
        assert_eq!(result.domain, "nas");
        assert_eq!(result.port, Some("5001".to_string()));
    }

    #[test]
    fn test_extract_domain_with_port() {
        // Port numbers should be stripped from extract_domain
        assert_eq!(extract_domain("https://example.com:8080"), "example.com");
        assert_eq!(extract_domain("https://example.com:8080/path"), "example.com");
        assert_eq!(extract_domain("https://blabla.asd.com:1234"), "blabla.asd.com");
        assert_eq!(extract_domain("https://www.example.com:443/login"), "example.com");
        assert_eq!(extract_domain("example.com:8080"), "example.com");
        assert_eq!(extract_domain("sub.domain.example.com:9000/path?query=1"), "sub.domain.example.com");
    }

    #[test]
    fn test_extract_domain_with_port_struct() {
        // Test the DomainWithPort struct
        let result = extract_domain_with_port("https://example.com:8080/path");
        assert_eq!(result.domain, "example.com");
        assert_eq!(result.port, Some("8080".to_string()));
        assert_eq!(result.with_port(), "example.com:8080");

        let result = extract_domain_with_port("https://example.com/path");
        assert_eq!(result.domain, "example.com");
        assert_eq!(result.port, None);
        assert_eq!(result.with_port(), "example.com");

        let result = extract_domain_with_port("https://www.myserver.local:9443/dashboard");
        assert_eq!(result.domain, "myserver.local");
        assert_eq!(result.port, Some("9443".to_string()));

        let result = extract_domain_with_port("myserver.local:8123");
        assert_eq!(result.domain, "myserver.local");
        assert_eq!(result.port, Some("8123".to_string()));

        // Test that ports are validated as numeric
        let result = extract_domain_with_port("https://example.com:abc/path");
        assert_eq!(result.domain, "example.com");
        assert_eq!(result.port, None); // Invalid port should be None
    }

    #[test]
    fn test_extract_root_domain() {
        assert_eq!(extract_root_domain("sub.example.com"), "example.com");
        assert_eq!(extract_root_domain("example.com"), "example.com");
        assert_eq!(extract_root_domain("sub.example.co.uk"), "example.co.uk");
        assert_eq!(extract_root_domain("example.co.uk"), "example.co.uk");
        assert_eq!(extract_root_domain("sub.example.com.au"), "example.com.au");
        assert_eq!(extract_root_domain("preview.myproject.vercel.app"), "myproject.vercel.app");

        // A public suffix or single label has no root domain of its own and is returned as-is.
        assert_eq!(extract_root_domain("github.io"), "github.io");
        assert_eq!(extract_root_domain("localhost"), "localhost");
        assert_eq!(extract_root_domain("plex"), "plex");
    }

    #[test]
    fn test_extract_root_domain_ip_literals_unchanged() {
        assert_eq!(extract_root_domain("192.168.1.5"), "192.168.1.5");
        assert_eq!(extract_root_domain("10.0.0.1"), "10.0.0.1");
        assert_eq!(extract_root_domain("::1"), "::1");
        assert_eq!(extract_root_domain("[2001:db8::1]"), "[2001:db8::1]");
    }

    #[test]
    fn test_ip_literals_require_exact_match() {
        // Same IP matches
        assert!(domains_match("192.168.1.5", "192.168.1.5"));

        // Distinct IPs sharing trailing octets must not match
        // (previously both reduced to root "1.5" and matched)
        assert!(!domains_match("192.168.1.5", "10.0.1.5"));

        // An IP must not be treated as a "subdomain" of a suffix of itself
        assert!(!domains_match("192.168.1.5", "168.1.5"));
        assert!(!domains_match("168.1.5", "192.168.1.5"));

        // IP vs regular domain never matches
        assert!(!domains_match("192.168.1.5", "example.com"));

        // IPv6 literals: exact match only (bare and bracketed forms)
        assert!(domains_match("::1", "::1"));
        assert!(!domains_match("::1", "::2"));
        assert!(domains_match("[2001:db8::1]", "[2001:db8::1]"));
        assert!(!domains_match("[2001:db8::1]", "[2001:db8::2]"));
    }

    #[test]
    fn test_domains_match() {
        // Exact match
        assert!(domains_match("example.com", "example.com"));

        // Subdomain match
        assert!(domains_match("sub.example.com", "example.com"));
        assert!(domains_match("example.com", "sub.example.com"));

        // Root domain match
        assert!(domains_match("app.example.com", "www.example.com"));

        // No match
        assert!(!domains_match("example.com", "different.com"));
        assert!(!domains_match("coolblue.nl", "coolblue.be"));

        // Critical: Substring match should not work (anti-phishing protection)
        // "another-example.com" contains "example.com" but is not a subdomain
        assert!(!domains_match("another-example.com", "example.com"));
        assert!(!domains_match("example.com", "another-example.com"));
        assert!(!domains_match("myexample.com", "example.com"));
        assert!(!domains_match("example.com.evil.com", "example.com"));
    }

    #[test]
    fn test_domains_match_shared_hosting_tenants() {
        // Sibling tenants on a shared suffix never match; the same tenant matches across its own subdomains.
        assert!(!domains_match("myproject.vercel.app", "evil-phish.vercel.app"));
        assert!(domains_match("preview.myproject.vercel.app", "myproject.vercel.app"));

        // A public suffix never matches the hosts under it, only itself.
        assert!(!domains_match("vercel.app", "myproject.vercel.app"));
        assert!(!domains_match("myhome.duckdns.org", "duckdns.org"));
        assert!(domains_match("duckdns.org", "duckdns.org"));

        // Internal hosts under an unlisted suffix keep matching on their last two labels.
        assert!(domains_match("nas.home.lan", "plex.home.lan"));
    }
}
