use crate::favicon::*;

fn urls(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

#[test]
fn web_urls_key_on_host() {
    assert_eq!(favicon_source_key("https://example.com"), "example.com");
    assert_eq!(favicon_source_key("http://example.com/login?a=1"), "example.com");
    assert_eq!(favicon_source_key("www.example.com"), "example.com");
    assert_eq!(favicon_source_key("example.com"), "example.com");
    assert_eq!(favicon_source_key("HTTPS://Example.COM"), "example.com");
    assert_eq!(favicon_source_key("  https://example.com  "), "example.com");
    assert_eq!(favicon_source_key("https://sub.example.co.uk/path"), "sub.example.co.uk");
}

#[test]
fn app_urls_have_no_favicon_source() {
    // App URLs have no favicon.
    assert_eq!(favicon_source_key("androidapp://com.example.android"), "");
    assert_eq!(favicon_source_key("androidapp://com.example.app"), "");
    assert_eq!(favicon_source_key("android://com.example.android.app"), "");
    assert_eq!(favicon_source_key("com.example.android.app"), "");
    assert_eq!(favicon_source_key("iosapp://com.example.ios"), "");
    assert_eq!(favicon_source_key("otpauth://totp/example"), "");
    assert_eq!(favicon_source_key("mailto:someone@example.com"), "");
}

#[test]
fn only_web_schemes_are_fetchable() {
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
fn scheme_less_input_needs_a_plausible_tld() {
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
fn unusable_input_has_no_favicon_source() {
    assert_eq!(favicon_source_key(""), "");
    assert_eq!(favicon_source_key("   "), "");
    assert_eq!(favicon_source_key("not a url"), "");
    assert_eq!(favicon_source_key("https://"), "");
    assert_eq!(favicon_source_key("http://"), "");
}

#[test]
fn non_default_port_is_part_of_the_key() {
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
fn default_port_collapses_onto_the_bare_host() {
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
fn select_skips_app_urls_and_keeps_item_order() {
    // An app URL listed before the website.
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
fn select_prefers_the_first_usable_url() {
    let target = select_favicon_target(&urls(&[
        "com.example.app",
        "https://first.example.com",
        "https://example.com",
    ]))
    .expect("first website URL should be selected");
    assert_eq!(target.source, "first.example.com");
}

#[test]
fn select_returns_none_when_no_url_is_fetchable() {
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
fn casing_is_ignored() {
    let lower = select_favicon_target(&urls(&["example.com"])).unwrap();
    for variant in ["Example.com", "example.com", "https://example.com"] {
        let target = select_favicon_target(&urls(&[variant])).unwrap();
        assert_eq!(target.source, "example.com", "source for {variant}");
        assert_eq!(target.url, lower.url, "fetch URL for {variant}");
    }

    let target = select_favicon_target(&urls(&["Www.Example.com"])).unwrap();
    assert_eq!(target.source, "example.com");
    assert_eq!(target.url, "https://www.example.com");

    let target = select_favicon_target(&urls(&["HTTPS://Example.COM/Login?Token=AbC"])).unwrap();
    assert_eq!(target.url, "https://example.com");
}

#[test]
fn fetch_url_is_the_origin_only() {
    let target = select_favicon_target(&urls(&["https://user:secret@example.com:8443/account/reset?token=abc#top"])).unwrap();
    assert_eq!(target.url, "https://example.com:8443");
}

#[test]
fn select_adds_missing_scheme_to_fetch_url() {
    let target = select_favicon_target(&urls(&["www.example.com"])).unwrap();
    assert_eq!(target.url, "https://www.example.com");
    assert_eq!(target.source, "example.com");

    let target = select_favicon_target(&urls(&["http://mediaserver:32400"])).unwrap();
    assert_eq!(target.url, "http://mediaserver:32400");
    assert_eq!(target.source, "mediaserver:32400");
}
