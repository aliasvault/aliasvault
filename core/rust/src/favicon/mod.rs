//! Favicon handling and source selection.

use crate::credential_matcher::domain::{authority_host_port, is_web_scheme, split_url};
use crate::credential_matcher::extract_domain_with_port;

/// The URL to fetch a favicon from, paired with the `Logos.Source` key it is stored under.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct FaviconTarget {
    pub url: String,
    pub source: String,
}

/// Derive the `Logos.Source` key for a URL.
pub fn favicon_source_key(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // Only the web schemes have a favicon to fetch. `androidapp://`, `otpauth://` and `mailto:`
    // name something that is not a website at all.
    let (scheme, _, _) = split_url(trimmed);
    if scheme.is_some_and(|scheme| !is_web_scheme(scheme)) {
        return String::new();
    }

    let host = extract_domain_with_port(trimmed);
    if host.domain.is_empty() {
        return String::new();
    }

    // A scheme is the user stating this is a website. Without one, the host itself is checked
    // to see if it looks like a public hostname.
    if scheme.is_none() && !looks_like_public_host(&host.domain) {
        return String::new();
    }

    match &host.port {
        Some(port) if !is_default_port(scheme, port) => host.with_port(),
        _ => host.domain,
    }
}

/// Pick the favicon target for an item from its URLs, in the order the item lists them.
///
/// Returns the first URL a favicon can actually be fetched from.
pub fn select_favicon_target(urls: &[String]) -> Option<FaviconTarget> {
    urls.iter().find_map(|raw| {
        let trimmed = raw.trim();
        let source = favicon_source_key(trimmed);
        if source.is_empty() {
            return None;
        }

        Some(FaviconTarget { url: canonical_fetch_url(trimmed), source })
    })
}

/// The origin to fetch a favicon from: lowercased scheme and host (with port), https when scheme-less. Userinfo, path
/// and query are dropped so the server never sees more of the item URL than the site it has to fetch from.
fn canonical_fetch_url(url: &str) -> String {
    let lowered = url.to_ascii_lowercase();
    let (scheme, authority, _) = split_url(&lowered);
    let scheme = scheme.filter(|scheme| is_web_scheme(scheme)).unwrap_or("https");
    match authority_host_port(authority) {
        (host, Some(port)) => format!("{scheme}://{host}:{port}"),
        (host, None) => format!("{scheme}://{host}"),
    }
}

/// Whether a scheme-less host is shaped like a public hostname, meaning its last label could be a TLD.
fn looks_like_public_host(host: &str) -> bool {
    match host.rsplit_once('.') {
        Some((_, tld)) => tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic()),
        None => false,
    }
}

/// Whether a port is the default for the scheme. Scheme-less URLs are treated as https.
fn is_default_port(scheme: Option<&str>, port: &str) -> bool {
    if scheme.is_some_and(|scheme| scheme.eq_ignore_ascii_case("http")) {
        port == "80"
    } else {
        port == "443"
    }
}

#[cfg(test)]
mod tests;
