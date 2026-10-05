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
    // New gTLDs that lead real package names; words like "app" or "shop" are left out, they lead hostnames far more often.
    "dev", "io", "ai", "tv",
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

    // A blob URL ("blob:https://example.com/<uuid>") belongs to the origin it wraps.
    let lowered = lowered.strip_prefix("blob:").unwrap_or(&lowered);
    let (scheme, authority, _) = split_url(lowered);

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

    let (host, port) = authority_host_port(authority);
    let domain = host.strip_prefix("www.").unwrap_or(host);

    if is_ip_literal(domain) {
        return DomainWithPort { domain: domain.to_string(), port };
    }

    // Without a scheme, require at least one dot to distinguish a hostname from random text.
    if domain.is_empty() || (!domain.contains('.') && !has_protocol) {
        return DomainWithPort::default();
    }

    let valid_chars = domain.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    let valid_structure = !domain.starts_with('.') && !domain.ends_with('.') && !domain.contains("..");
    if !valid_chars || !valid_structure {
        return DomainWithPort::default();
    }

    DomainWithPort { domain: domain.to_string(), port }
}

/// The host and numeric port of a URL authority, without userinfo and without the trailing dot of a fully qualified name.
pub(crate) fn authority_host_port(authority: &str) -> (&str, Option<String>) {
    // The host is what follows any userinfo: "https://user@example.com" opens example.com.
    let host_and_port = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
    let (host, port) = split_host_port(host_and_port);
    (host.strip_suffix('.').unwrap_or(host), port)
}

/// Split an authority without userinfo into its host and numeric port; a bracketed IPv6 host keeps its brackets.
fn split_host_port(authority: &str) -> (&str, Option<String>) {
    let (host, port) = match authority.strip_prefix('[').and_then(|rest| rest.find(']')) {
        Some(end) => {
            let (host, rest) = authority.split_at(end + 2);
            (host, rest.strip_prefix(':'))
        }
        None => match authority.split_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        },
    };
    let port = port.filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())).map(String::from);
    (host, port)
}

/// Extract domain from URL, handling both full URLs and partial domains.
/// Returns empty string if not a valid URL/domain.
/// This strips port numbers; use extract_domain_with_port() to preserve port info.
pub fn extract_domain(url: &str) -> String {
    extract_domain_with_port(url).domain
}

/// Check if a host string is an IP address literal (IPv4 with an optional trailing dot, or IPv6, optionally bracketed).
/// IP addresses have no domain hierarchy, so they must never be reduced to a "root domain".
fn is_ip_literal(host: &str) -> bool {
    let bare = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')).unwrap_or(host);
    let bare = bare.strip_suffix('.').unwrap_or(bare);
    bare.parse::<std::net::IpAddr>().is_ok()
}

/// The registrable domain of a domain per the Public Suffix List, or the input itself for a public suffix or IP literal.
pub fn extract_root_domain(domain: &str) -> String {
    if is_ip_literal(domain) {
        return domain.to_string();
    }

    public_suffix::registrable_domain(domain).unwrap_or(domain).to_string()
}

/// Whether two extracted domains are the same domain or share a registrable domain.
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

    /*
     * Anti-phishing: only a shared registrable domain matches. Two hosts under a public suffix ("victim.vercel.app",
     * "attacker.vercel.app") never match, and neither do a suffix and a host under it (it has no registrable domain).
     */
    match (public_suffix::registrable_domain(domain1), public_suffix::registrable_domain(domain2)) {
        (Some(root1), Some(root2)) => root1 == root2,
        _ => false,
    }
}

/// Check if a WebAuthn rpId is allowed for a host based on the Public Suffix List.
pub fn is_rp_id_allowed_for_host(rp_id: &str, host: &str) -> bool {
    let (Some(rp_id), Some(host)) = (normalize_rp_host(rp_id), normalize_rp_host(host)) else {
        return false;
    };

    if rp_id == host {
        return true;
    }
    if is_ip_literal(&rp_id) || is_ip_literal(&host) || !host.ends_with(&format!(".{rp_id}")) {
        return false;
    }

    match (public_suffix::registrable_domain(&rp_id), public_suffix::registrable_domain(&host)) {
        (Some(_), Some(host_root)) => rp_id == host_root || rp_id.ends_with(&format!(".{host_root}")),
        _ => false,
    }
}

/// At most this many distinct registrable domain labels are read from a `/.well-known/webauthn` file.
const MAX_RELATED_ORIGIN_LABELS: usize = 10;

/// WebAuthn related origins validation.
pub fn is_related_origin_allowed(caller_origin: &str, origins: &[String]) -> bool {
    let mut labels_seen: Vec<&str> = Vec::new();
    for origin in origins {
        let Some(host) = origin_host(origin) else { continue };
        if is_ip_literal(host) {
            continue;
        }
        let Some(label) = public_suffix::registrable_domain(host).and_then(|domain| domain.split('.').next()) else { continue };

        let seen = labels_seen.contains(&label);
        if labels_seen.len() >= MAX_RELATED_ORIGIN_LABELS && !seen {
            continue;
        }
        if origin == caller_origin {
            return true;
        }
        if !seen {
            labels_seen.push(label);
        }
    }
    false
}

/// The host of a serialized web origin ("https://login.example.com:8443" gives "login.example.com").
fn origin_host(origin: &str) -> Option<&str> {
    let (scheme, authority, rest) = split_url(origin);
    let scheme = scheme.filter(|scheme| is_web_scheme(scheme))?;
    if !origin[scheme.len() + 1..].starts_with("//") || !rest.is_empty() || authority.contains('@') {
        return None;
    }
    let (host, _) = split_host_port(authority);
    (!host.is_empty()).then_some(host)
}

/// A host or rp id lowercased and without its trailing dot, or None when empty or holding a port or path.
fn normalize_rp_host(value: &str) -> Option<String> {
    let lowered = value.trim().to_ascii_lowercase();
    let normalized = lowered.strip_suffix('.').unwrap_or(&lowered);
    if normalized.is_empty() || normalized.contains(['/', ':']) {
        return None;
    }
    Some(normalized.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_app_package_names() {
        assert!(is_app_package_name("com.coolblue.app"));
        assert!(is_app_package_name("nl.marktplaats.android"));
        assert!(is_app_package_name("org.example.app"));

        assert!(!is_app_package_name("https://example.com"));
        assert!(!is_app_package_name("example.com"));
        assert!(!is_app_package_name("coolblue.nl"));
        assert!(!is_app_package_name("nodot"));
        assert!(is_app_package_name("tv.twitch.android.app"));
        assert!(!is_app_package_name("app.example.com"), "a scheme-less hostname under a common subdomain word");
    }

    #[test]
    fn extracts_domain() {
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
    fn extract_domain_single_word_hostname_with_port() {
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
    fn extract_domain_strips_port() {
        // Port numbers should be stripped from extract_domain
        assert_eq!(extract_domain("https://example.com:8080"), "example.com");
        assert_eq!(extract_domain("https://example.com:8080/path"), "example.com");
        assert_eq!(extract_domain("https://blabla.asd.com:1234"), "blabla.asd.com");
        assert_eq!(extract_domain("https://www.example.com:443/login"), "example.com");
        assert_eq!(extract_domain("example.com:8080"), "example.com");
        assert_eq!(extract_domain("sub.domain.example.com:9000/path?query=1"), "sub.domain.example.com");
    }

    #[test]
    fn extract_domain_with_port_struct() {
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
    fn extract_domain_normalizes_host() {
        // Userinfo is dropped: the host is what follows the last "@".
        assert_eq!(extract_domain("https://paypal.com@evil.com/"), "evil.com");
        assert_eq!(extract_domain("https://user:pass@www.example.com:8443/"), "example.com");

        // One trailing dot is dropped, before the "www." prefix.
        assert_eq!(extract_domain("https://paypal.com./"), "paypal.com");
        assert_eq!(extract_domain("https://www.paypal.com./"), "paypal.com");
        assert_eq!(extract_domain("https://paypal.com../"), "");

        // Underscores are accepted in host labels.
        assert_eq!(extract_domain("https://www_paypal.evil.com/"), "www_paypal.evil.com");

        // Bracketed IPv6 keeps its brackets and splits off the port after the bracket.
        let ipv6 = extract_domain_with_port("http://[::1]:8080/paypal");
        assert_eq!(ipv6.domain, "[::1]");
        assert_eq!(ipv6.port, Some("8080".to_string()));
        assert_eq!(extract_domain("http://[2001:db8::1]/"), "[2001:db8::1]");
        assert_eq!(extract_domain("http://[::1/"), "");

        // A blob URL resolves to the origin it wraps; other non-web schemes give no domain.
        assert_eq!(extract_domain("blob:https://paypal.evil.com/0b2c3d4e"), "paypal.evil.com");
        assert_eq!(extract_domain("blob:null/0b2c3d4e"), "");
        assert_eq!(extract_domain("filesystem:https://paypal.com/temporary/x"), "");
        assert_eq!(extract_domain("data:text/html,paypal.com"), "");
    }

    #[test]
    fn extracts_root_domain() {
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

        // A trailing dot never reduces a domain to its TLD: "bank.com." and "evil.com." must not share "com.".
        assert_eq!(extract_root_domain("bank.com."), "bank.com");
        assert_eq!(extract_root_domain("login.bank.com."), "bank.com");
        assert_eq!(extract_root_domain("victim.vercel.app."), "victim.vercel.app");
        assert_eq!(extract_root_domain("com."), "com.");

        // A malformed domain has no root domain and is returned as-is.
        assert_eq!(extract_root_domain(".com"), ".com");
        assert_eq!(extract_root_domain("a..b.com"), "a..b.com");
        assert_eq!(extract_root_domain(".."), "..");
    }

    #[test]
    fn extract_root_domain_keeps_ip_literals() {
        assert_eq!(extract_root_domain("192.168.1.5"), "192.168.1.5");
        assert_eq!(extract_root_domain("10.0.0.1"), "10.0.0.1");
        assert_eq!(extract_root_domain("::1"), "::1");
        assert_eq!(extract_root_domain("[2001:db8::1]"), "[2001:db8::1]");
        assert_eq!(extract_root_domain("192.168.1.5."), "192.168.1.5.");
    }

    #[test]
    fn related_origins_allowlist() {
        let origins = |list: &[&str]| list.iter().map(|o| o.to_string()).collect::<Vec<_>>();

        let x = origins(&["https://twitter.com", "https://x.com", "https://mobile.twitter.com:8443"]);
        assert!(is_related_origin_allowed("https://twitter.com", &x));
        assert!(is_related_origin_allowed("https://mobile.twitter.com:8443", &x));
        assert!(!is_related_origin_allowed("https://mobile.twitter.com", &x));
        assert!(!is_related_origin_allowed("http://twitter.com", &x));
        assert!(!is_related_origin_allowed("https://evil.com", &x));
        assert!(!is_related_origin_allowed("https://twitter.com", &[]));

        // Only the first MAX_RELATED_ORIGIN_LABELS distinct labels count; origins sharing a counted label stay reachable.
        let mut many: Vec<String> = (0..=MAX_RELATED_ORIGIN_LABELS).map(|i| format!("https://site{i}.com")).collect();
        many.extend(origins(&["https://shop.site0.co.uk", "https://www.site1.com"]));
        assert!(is_related_origin_allowed(&format!("https://site{}.com", MAX_RELATED_ORIGIN_LABELS - 1), &many));
        assert!(!is_related_origin_allowed(&format!("https://site{MAX_RELATED_ORIGIN_LABELS}.com"), &many));
        assert!(is_related_origin_allowed("https://shop.site0.co.uk", &many));
        assert!(is_related_origin_allowed("https://www.site1.com", &many));

        // Entries without a registrable domain neither match nor use up a label.
        let mut skipped = origins(&["https://vercel.app", "https://192.168.1.5", "https://localhost", "null"]);
        skipped.extend((1..=MAX_RELATED_ORIGIN_LABELS).map(|i| format!("https://{i}.com")));
        assert!(!is_related_origin_allowed("https://vercel.app", &skipped));
        assert!(!is_related_origin_allowed("https://192.168.1.5", &skipped));
        assert!(!is_related_origin_allowed("null", &skipped));
        assert!(is_related_origin_allowed(&format!("https://{MAX_RELATED_ORIGIN_LABELS}.com"), &skipped));
    }

    #[test]
    fn rp_id_allowed_for_host_or_parent() {
        // The host itself and parent domains below the public suffix.
        assert!(is_rp_id_allowed_for_host("example.com", "login.example.com"));
        assert!(is_rp_id_allowed_for_host("Example.COM.", "login.example.com"));
        assert!(is_rp_id_allowed_for_host("myproject.vercel.app", "preview.myproject.vercel.app"));
        assert!(is_rp_id_allowed_for_host("github.io", "github.io"));

        // Public suffixes, siblings and lookalikes.
        assert!(!is_rp_id_allowed_for_host("vercel.app", "evil.vercel.app"));
        assert!(!is_rp_id_allowed_for_host("district.sch.uk", "myschool.district.sch.uk"));
        assert!(!is_rp_id_allowed_for_host("accounts.example.com", "evil.example.com"));
        assert!(!is_rp_id_allowed_for_host("example.com", "myexample.com"));

        // IP addresses only as themselves, malformed input never.
        assert!(is_rp_id_allowed_for_host("192.168.1.5", "192.168.1.5"));
        assert!(!is_rp_id_allowed_for_host("1.5", "192.168.1.5"));
        assert!(!is_rp_id_allowed_for_host("", "example.com"));
        assert!(!is_rp_id_allowed_for_host("example.com:443", "example.com"));
    }

    #[test]
    fn ip_literals_require_exact_match() {
        // Same IP matches
        assert!(domains_match("192.168.1.5", "192.168.1.5"));

        // Distinct IPs sharing trailing octets must not match
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
    fn matches_domains() {
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
    fn domains_match_shared_hosting_tenants() {
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
