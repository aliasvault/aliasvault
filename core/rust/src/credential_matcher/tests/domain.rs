use crate::credential_matcher::domain::*;

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
