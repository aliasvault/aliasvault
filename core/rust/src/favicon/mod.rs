//! Favicon handling and source selection.

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
    let scheme = url_scheme(trimmed);
    if let Some(scheme) = &scheme {
        if scheme != "http" && scheme != "https" {
            return String::new();
        }
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
        Some(port) if !is_default_port(trimmed, port) => host.with_port(),
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

        Some(FaviconTarget {
            url: with_scheme(trimmed),
            source,
        })
    })
}

/// Prefix a scheme-less URL with `https://`, matching what the favicon API does server side.
fn with_scheme(url: &str) -> String {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        url.to_string()
    } else {
        format!("https://{}", url)
    }
}

/// The lowercased scheme a URL is written with, or `None` when it carries none.
fn url_scheme(url: &str) -> Option<String> {
    let index = url.find(':')?;
    let (scheme, rest) = (&url[..index], &url[index + 1..]);

    if !scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        || !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
    {
        return None;
    }

    let port_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let port = &rest[..port_end];
    if !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }

    Some(scheme.to_ascii_lowercase())
}

/// Whether a scheme-less host is shaped like a public hostname, meaning its last label could be a TLD.
/// TODO: look into replacing this with the full public suffix list here once that is available.
fn looks_like_public_host(host: &str) -> bool {
    match host.rsplit_once('.') {
        Some((_, tld)) => tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic()),
        None => false,
    }
}

/// Whether a port is the default for the URL's scheme. Scheme-less URLs are treated as
/// https.
fn is_default_port(url: &str, port: &str) -> bool {
    if url.to_ascii_lowercase().starts_with("http://") {
        port == "80"
    } else {
        port == "443"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn urls(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| v.to_string()).collect()
    }

    #[test]
    fn test_web_urls_key_on_host() {
        assert_eq!(favicon_source_key("https://example.com"), "example.com");
        assert_eq!(favicon_source_key("http://example.com/login?a=1"), "example.com");
        assert_eq!(favicon_source_key("www.example.com"), "example.com");
        assert_eq!(favicon_source_key("example.com"), "example.com");
        assert_eq!(favicon_source_key("HTTPS://Example.COM"), "example.com");
        assert_eq!(favicon_source_key("  https://example.com  "), "example.com");
        assert_eq!(favicon_source_key("https://sub.example.co.uk/path"), "sub.example.co.uk");
    }

    #[test]
    fn test_app_urls_have_no_favicon_source() {
        // Illegitimate URLs are skipped.
        assert_eq!(favicon_source_key("androidapp://com.example.android"), "");
        assert_eq!(favicon_source_key("androidapp://com.example.app"), "");
        assert_eq!(favicon_source_key("android://com.example.android.app"), "");
        assert_eq!(favicon_source_key("com.example.android.app"), "");
        assert_eq!(favicon_source_key("iosapp://com.example.ios"), "");
        assert_eq!(favicon_source_key("otpauth://totp/example"), "");
        assert_eq!(favicon_source_key("mailto:someone@example.com"), "");
    }

    #[test]
    fn test_only_web_schemes_are_fetchable() {
        // A scheme other than http(s) names something that is not a website.
        assert_eq!(favicon_source_key("ftp://files.example.com"), "");
        assert_eq!(favicon_source_key("file:///Users/me/index.html"), "");
        assert_eq!(favicon_source_key("javascript:alert(1)"), "");
        assert_eq!(favicon_source_key("data:text/html,<h1>hi</h1>"), "");
        assert_eq!(favicon_source_key("chrome-extension://abcdef/index.html"), "");
        assert_eq!(favicon_source_key("music:track:exampleid"), "");
        assert_eq!(favicon_source_key("s3://bucket.example.com/key"), "");

        // A host with a port is not a scheme, however much it looks like one.
        assert_eq!(favicon_source_key("example.com:8080"), "example.com:8080");
        assert_eq!(favicon_source_key("example.com:8080/login"), "example.com:8080");
    }

    #[test]
    fn test_scheme_less_input_needs_a_plausible_tld() {
        // Dotted text a user typed into a URL field is not a host to fetch from.
        assert_eq!(favicon_source_key("backup.7z"), "");
        assert_eq!(favicon_source_key("v1.0"), "");
        assert_eq!(favicon_source_key("release.2024"), "");
        assert_eq!(favicon_source_key("192.168.1.5"), "");
        assert_eq!(favicon_source_key("1.2.3.4:8080"), "");

        // Anything TLD-shaped is still accepted, including new gTLDs and LAN suffixes.
        assert_eq!(favicon_source_key("example.xyz"), "example.xyz");
        assert_eq!(favicon_source_key("nas.local"), "nas.local");
        assert_eq!(favicon_source_key("gateway.home:8080"), "gateway.home:8080");

        // With a scheme the user has said what they mean, so the shape check does not apply.
        assert_eq!(favicon_source_key("http://192.168.1.5:8080"), "192.168.1.5:8080");
        assert_eq!(favicon_source_key("http://mediaserver:32400"), "mediaserver:32400");
    }

    #[test]
    fn test_unusable_input_has_no_favicon_source() {
        assert_eq!(favicon_source_key(""), "");
        assert_eq!(favicon_source_key("   "), "");
        assert_eq!(favicon_source_key("not a url"), "");
        assert_eq!(favicon_source_key("https://"), "");
        assert_eq!(favicon_source_key("http://"), "");
    }

    #[test]
    fn test_non_default_port_is_part_of_the_key() {
        assert_eq!(favicon_source_key("http://localhost:8080"), "localhost:8080");
        assert_eq!(favicon_source_key("http://localhost:9090"), "localhost:9090");
        assert_ne!(
            favicon_source_key("http://localhost:8080"),
            favicon_source_key("http://localhost:9090")
        );
        assert_eq!(favicon_source_key("https://nas.local:5001/files"), "nas.local:5001");
        assert_eq!(favicon_source_key("example.com:8080"), "example.com:8080");
    }

    #[test]
    fn test_default_port_collapses_onto_the_bare_host() {
        assert_eq!(favicon_source_key("http://localhost:80"), "localhost");
        assert_eq!(favicon_source_key("https://example.com:443"), "example.com");
        assert_eq!(favicon_source_key("example.com:443"), "example.com");
        assert_eq!(
            favicon_source_key("https://example.com:443/login"),
            favicon_source_key("https://example.com/login")
        );
        // A non-default port for the scheme in use is still kept.
        assert_eq!(favicon_source_key("https://localhost:80"), "localhost:80");
        assert_eq!(favicon_source_key("http://example.com:443"), "example.com:443");
    }

    #[test]
    fn test_select_skips_app_urls_and_keeps_item_order() {
        // The reported item shape: an app URL listed first, the website second.
        let target = select_favicon_target(&urls(&[
            "androidapp://com.example.app",
            "https://example.com",
        ]))
        .expect("website URL should be selected");
        assert_eq!(target.url, "https://example.com");
        assert_eq!(target.source, "example.com");

        // Reordering must not change the answer.
        let reordered = select_favicon_target(&urls(&[
            "https://example.com",
            "androidapp://com.example.app",
        ]))
        .expect("website URL should be selected");
        assert_eq!(reordered, target);
    }

    #[test]
    fn test_select_prefers_the_first_usable_url() {
        let target = select_favicon_target(&urls(&[
            "com.example.app",
            "https://first.example.com",
            "https://example.com",
        ]))
        .expect("first website URL should be selected");
        assert_eq!(target.source, "first.example.com");
    }

    #[test]
    fn test_select_returns_none_when_no_url_is_fetchable() {
        assert_eq!(select_favicon_target(&urls(&[])), None);
        assert_eq!(
            select_favicon_target(&urls(&[
                "androidapp://com.example.android",
                "android://com.example.android.app",
                "com.example.music",
            ])),
            None
        );
        assert_eq!(select_favicon_target(&urls(&["", "   "])), None);
    }

    #[test]
    fn test_select_adds_missing_scheme_to_fetch_url() {
        let target = select_favicon_target(&urls(&["www.example.com"])).unwrap();
        assert_eq!(target.url, "https://www.example.com");
        assert_eq!(target.source, "example.com");

        let target = select_favicon_target(&urls(&["http://mediaserver:32400"])).unwrap();
        assert_eq!(target.url, "http://mediaserver:32400");
        assert_eq!(target.source, "mediaserver:32400");
    }
}

