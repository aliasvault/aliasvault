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
pub(super) const MAX_RELATED_ORIGIN_LABELS: usize = 10;

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
