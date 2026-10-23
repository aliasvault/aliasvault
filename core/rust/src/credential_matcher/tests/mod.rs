//! The autofill matcher: which credentials a URL, app package or page title offers, in priority order, and which
//! it must never offer (anti-phishing).

use super::*;

fn credential(name: &str, urls: &[&str], username: &str) -> Credential {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    Credential { id: format!("test-id-{:016x}", COUNTER.fetch_add(1, Ordering::SeqCst)), item_name: Some(name.to_string()), item_urls: urls.iter().map(|u| u.to_string()).collect(), username: Some(username).filter(|u| !u.is_empty()).map(str::to_string) }
}

fn input(credentials: &[Credential], current_url: &str, page_title: &str) -> CredentialMatcherInput {
    CredentialMatcherInput { credentials: credentials.to_vec(), current_url: current_url.to_string(), page_title: page_title.to_string(), matching_mode: AutofillMatchingMode::Default, ignore_port: false, max_results: None }
}

/// The names of the credentials the matcher offers for `current_url` and `page_title`, in order.
fn names(credentials: &[Credential], current_url: &str, page_title: &str) -> Vec<String> {
    names_for(credentials, input(credentials, current_url, page_title))
}

fn names_for(credentials: &[Credential], input: CredentialMatcherInput) -> Vec<String> {
    filter_credentials(input).matched_ids.iter().map(|id| credentials.iter().find(|c| c.id == *id).unwrap().item_name.clone().unwrap()).collect()
}

/// Every matching mode's output for `current_url`.
fn all_modes(credentials: &[Credential], current_url: &str) -> Vec<(AutofillMatchingMode, CredentialMatcherOutput)> {
    [AutofillMatchingMode::Default, AutofillMatchingMode::UrlSubdomain, AutofillMatchingMode::UrlExact].into_iter().map(|mode| (mode, filter_credentials(CredentialMatcherInput { matching_mode: mode, ..input(credentials, current_url, "") }))).collect()
}

/// The dataset every platform's matcher is checked against.
fn shared_credentials() -> Vec<Credential> {
    vec![
        credential("Gmail", &["https://gmail.com"], "user@gmail.com"),
        credential("Google", &["https://google.com"], "user@google.com"),
        credential("Coolblue", &["https://www.coolblue.nl"], "user@coolblue.nl"),
        credential("Amazon", &["https://amazon.com"], "user@amazon.com"),
        credential("Coolblue App", &["com.coolblue.app"], "user@coolblue.nl"),
        credential("Dumpert", &["dumpert.nl"], "user@dumpert.nl"),
        credential("GitHub", &["github.com"], "user@github.com"),
        credential("Stack Overflow", &["https://stackoverflow.com"], "user@stackoverflow.com"),
        credential("Subdomain Example", &["https://app.example.com"], "user@example.com"),
        credential("Title Only newyorktimes", &[], ""),
        credential("Bank Account", &["https://secure-bank.com"], "user@bank.com"),
        credential("AliExpress", &["https://aliexpress.com"], "user@aliexpress.com"),
        credential("Reddit", &[], "user@reddit.com"),
    ]
}

#[test]
fn urls_match_their_domain_whatever_the_protocol_www_path_or_query() {
    let credentials = shared_credentials();
    for (url, expected) in [
        ("www.coolblue.nl", vec!["Coolblue"]),
        ("coolblue.nl", vec!["Coolblue"]),
        ("https://www.coolblue.nl/product/12345?ref=google", vec!["Coolblue"]),
        ("https://gmail.com/signin", vec!["Gmail"]),
        ("https://gmail.com#inbox", vec!["Gmail"]),
        ("https://stackoverflow.com/questions?tab=newest", vec!["Stack Overflow"]),
        ("https://github.com", vec!["GitHub"]),
        ("http://github.com", vec!["GitHub"]),
        ("github.com", vec!["GitHub"]),
        ("https://github.com/user/repo", vec!["GitHub"]),
        ("https://www.dumpert.nl", vec!["Dumpert"]),
        ("https://dumpert.nl", vec!["Dumpert"]),
        ("https://mail.google.com", vec!["Google"]),
        ("https://app.example.com", vec!["Subdomain Example"]),
        ("https://www.example.com", vec!["Subdomain Example"]),
        ("https://example.com", vec!["Subdomain Example"]),
        ("https://another-example.com", vec![]),
        ("com.coolblue.app", vec!["Coolblue App"]),
        ("https://nonexistent.com", vec![]),
        ("https://coolblue.be", vec![]),
        ("https://secure-bankk.com", vec![]),
        ("not a url", vec![]),
        ("", vec![]),
    ] {
        assert_eq!(names(&credentials, url, ""), expected, "{url}");
    }
}

#[test]
fn names_match_only_when_the_input_is_no_url_and_only_credentials_without_urls() {
    let credentials = shared_credentials();
    // A non-URL search string falls through to the page title; punctuation is stripped and only whole words count.
    assert_eq!(names(&credentials, "invalid-url", "newyorktimes"), vec!["Title Only newyorktimes"]);
    assert_eq!(names(&credentials, "invalid-url", "Reddit, social media platform"), vec!["Reddit"]);
    assert!(names(&credentials, "", "Express Yourself App | Description").is_empty(), "'Express' is not the whole word 'AliExpress'");

    // A web page never falls through to the title: a URL match wins, and without one items with URLs are never offered by name.
    let with_url = vec![credential("blabla service", &["https://blabla.asd.com:1234"], "user@blabla.com"), credential("asd", &[], "user@asd.com"), credential("blabla", &[], "user@blabla.com")];
    assert_eq!(names(&with_url, "https://blabla.asd.com:1234/login", "Welcome to blabla asd service"), vec!["blabla service"]);

    // Words of the root domain (not its subdomains) do match items without URLs, so a note named after a site is offered.
    let notes = vec![credential("Test Dumpert", &["https://other-site.com"], ""), credential("Dumpert Account", &[], ""), credential("Some Other Item", &[], "")];
    assert_eq!(names(&notes, "https://www.dumpert.nl", ""), vec!["Dumpert Account"]);
}

#[test]
fn app_packages_match_exactly_and_never_borrow_a_website_credential() {
    let credentials = vec![
        credential("Google App", &["com.google.android.googlequicksearchbox"], ""),
        credential("Facebook", &["com.facebook.katana"], ""),
        credential("Coolblue", &["https://www.coolblue.nl", "com.coolblue.app", "nl.coolblue.ios"], ""),
        credential("Generic Site", &["example.com"], ""),
        credential("Marktplaats.nl", &[], ""),
        credential("Dumpert.nl", &[], ""),
    ];
    assert_eq!(names(&credentials, "com.google.android.googlequicksearchbox", ""), vec!["Google App"]);
    assert_eq!(names(&credentials, "com.facebook.katana", ""), vec!["Facebook"]);
    assert_eq!(names(&credentials, "nl.coolblue.ios", ""), vec!["Coolblue"], "any of a credential's URLs may be the package");
    assert_eq!(names(&credentials, "https://example.com", ""), vec!["Generic Site"]);
    assert_eq!(names(&credentials, "nl.marktplaats.android", ""), vec!["Marktplaats.nl"], "a reversed domain matches on its name, not on the TLD it shares");

    // An app package without a linked credential gets, at most, a credential without URLs: never the website's.
    let paypal = vec![credential("PayPal", &["https://paypal.com"], "victim"), credential("PayPal Notes", &[], "")];
    for package in ["com.fake.paypal", "com.paypal.rewards", "net.paypal.cashback"] {
        for (mode, output) in all_modes(&paypal, package) {
            assert_eq!(output.matched_ids, vec![paypal[1].id.clone()], "{package} in {mode:?} mode");
            assert_eq!(output.matched_priority, 4);
        }
    }
    assert!(names(&paypal[..1], "com.paypal.rewards", "PayPal Rewards").is_empty(), "without a credential lacking URLs there is nothing to offer");
}

#[test]
fn root_domains_follow_the_public_suffix_list() {
    // Multi-part suffixes, and shared hosts whose tenants must never collapse into one root domain.
    let credentials = vec![
        credential("Example Site AU", &["https://example.com.au"], ""),
        credential("BlaBla AU", &["https://blabla.blabla.com.au"], ""),
        credential("UK Site", &["https://example.co.uk"], ""),
        credential("My Vercel App", &["https://myproject.vercel.app/login"], ""),
        credential("My GitHub Pages", &["https://victim.github.io"], ""),
        credential("My Shop", &["https://victim-shop.myshopify.com/admin"], ""),
        credential("My Worker", &["https://victim.workers.dev"], ""),
    ];
    assert_eq!(names(&credentials, "https://blabla.blabla.com.au", ""), vec!["BlaBla AU"]);
    assert_eq!(names(&credentials, "https://example.com.au", ""), vec!["Example Site AU"]);
    assert_eq!(names(&credentials, "https://example.co.uk", ""), vec!["UK Site"]);
    assert_eq!(names(&credentials, "https://preview.myproject.vercel.app", ""), vec!["My Vercel App"], "a tenant's own subdomains still match");
    assert_eq!(names(&credentials, "https://docs.victim.github.io", ""), vec!["My GitHub Pages"]);
    for phishing_url in ["https://evil-phish.vercel.app/", "https://attacker.github.io/login", "https://attacker-shop.myshopify.com/admin", "https://attacker.workers.dev", "https://vercel.app", "https://github.io"] {
        for (mode, output) in all_modes(&credentials, phishing_url) {
            assert!(output.matched_ids.is_empty(), "{phishing_url} in {mode:?} mode must not match: {:?}", output.matched_ids);
        }
    }
}

#[test]
fn any_of_a_credentials_urls_matches_and_whitespace_around_them_is_ignored() {
    let credentials = vec![
        credential("Vodafone", &["https://www.vodafone.com", "https://my.vodafone.de", "https://www.vodafone.nl"], ""),
        credential("Amazon", &["https://amazon.fr/", " https://amazon.de", "amazon.it\t", " com.amazon.app \n"], ""),
        credential("Other Site", &["https://example.com"], ""),
    ];
    for (url, expected) in [("https://www.vodafone.com/account", "Vodafone"), ("https://my.vodafone.de/login", "Vodafone"), ("https://www.vodafone.nl/inloggen", "Vodafone"), ("https://portal.vodafone.nl", "Vodafone"), ("https://www.amazon.de/ap/signin", "Amazon"), ("https://amazon.it", "Amazon"), ("com.amazon.app", "Amazon")] {
        assert_eq!(names(&credentials, url, ""), vec![expected], "{url}");
    }
    assert!(names(&credentials, "https://vodafone.be", "").is_empty());

    let output = filter_credentials(input(&[credential("Two sites", &["https://app.example.com", "https://example.org"], "")], "https://example.org", ""));
    assert_eq!((output.matched_ids.len(), output.matched_priority), (1, 2), "an exact match on the second URL is a URL match");
}

#[test]
fn the_best_domain_rank_wins_and_excludes_the_rest() {
    // Exact domain and port beats exact domain beats subdomain or root domain; only the best rank is offered.
    let services = vec![
        credential("Service A (Port 8080)", &["https://myserver.local:8080"], ""),
        credential("Service B (Port 9000)", &["https://myserver.local:9000"], ""),
        credential("Service C (No Port)", &["https://myserver.local"], ""),
    ];
    assert_eq!(names(&services, "https://myserver.local:8080/dashboard", ""), vec!["Service A (Port 8080)"]);
    assert_eq!(names(&services, "https://myserver.local/home", ""), vec!["Service C (No Port)"]);
    assert_eq!(names(&services, "https://myserver.local:5000/new", "").len(), 3, "no port matches, so every credential on the domain is offered");

    let asd = vec![credential("Exact Match Site", &["https://blabla.asd.com:1234"], ""), credential("Root Domain", &["https://asd.com"], ""), credential("Other Subdomain", &["https://bloe.asd.com"], "")];
    assert_eq!(names(&asd, "https://blabla.asd.com:1234/page", "Some Page Title"), vec!["Exact Match Site"]);
    assert_eq!(names(&asd, "https://blabla.asd.com/page", ""), vec!["Exact Match Site"], "the same domain on another port still beats the root domain");
    assert_eq!(names(&asd, "https://asd.com/login", ""), vec!["Root Domain"]);
    assert_eq!(names(&asd, "https://bloe.asd.com/app", ""), vec!["Other Subdomain"]);

    let root_only = vec![credential("Root Domain Only", &["https://example.com"], "")];
    assert_eq!(names(&root_only, "https://app.example.com/login", ""), vec!["Root Domain Only"], "without an exact match a subdomain matches the root domain credential");
}

#[test]
fn single_word_hosts_and_localhost_match_with_their_ports() {
    let credentials = vec![
        credential("Plex Media Server", &["http://plex:32400"], ""),
        credential("Pi-hole", &["http://pihole/admin"], ""),
        credential("Router Admin", &["http://router"], ""),
        credential("Local API", &["http://localhost:3000"], ""),
        credential("Local Backend", &["http://localhost:81"], ""),
        credential("Local No Port", &["http://localhost"], ""),
        credential("Plex No Protocol", &["plex:32400"], ""),
    ];
    for (url, expected) in [
        ("http://plex:32400/web/index.html", vec!["Plex Media Server"]),
        ("http://pihole/admin/index.php", vec!["Pi-hole"]),
        ("http://router", vec!["Router Admin"]),
        ("http://router:8080", vec!["Router Admin"]),
        ("http://localhost:81?debug=true", vec!["Local Backend"]),
        ("http://localhost:3000", vec!["Local API"]),
        ("http://localhost", vec!["Local No Port"]),
        ("http://localhost:5000", vec!["Local API", "Local Backend", "Local No Port"]),
    ] {
        assert_eq!(names(&credentials, url, ""), expected, "{url}");
    }
    assert!(names(&credentials[6..], "http://plex:32400", "").is_empty(), "a stored single-word host needs its protocol to be extractable");
}

#[test]
fn ignoring_the_port_treats_every_port_of_a_domain_alike() {
    // Android autofill does not know the port, so a bare host has to offer the credentials stored with one.
    let ignore_port = |credentials: &[Credential], url: &str| names_for(credentials, CredentialMatcherInput { ignore_port: true, ..input(credentials, url, "") });
    let ip = vec![
        credential("Service on 5000", &["https://192.168.1.10:5000"], ""),
        credential("Service on 6000", &["https://192.168.1.10:6000"], ""),
        credential("Service no port", &["https://192.168.1.10"], ""),
        credential("Router Admin", &["https://192.168.1.1"], ""),
    ];
    assert_eq!(names(&ip, "https://192.168.1.10", ""), vec!["Service no port"]);
    assert_eq!(ignore_port(&ip, "https://192.168.1.10"), vec!["Service on 5000", "Service on 6000", "Service no port"]);
    assert_eq!(ignore_port(&ip, "https://192.168.1.1"), vec!["Router Admin"]);

    let sub = vec![credential("App Portal", &["https://app.example.com:8080"], ""), credential("Main Site", &["https://example.com"], "")];
    assert_eq!(ignore_port(&sub, "https://api.example.com").len(), 2, "subdomain matching still applies");
}

#[test]
fn unusual_hosts_are_normalized_and_never_fall_through_to_name_matching() {
    let credentials = vec![credential("PayPal", &["https://paypal.com"], "victim"), credential("PayPal Notes", &[], ""), credential("Intranet", &["https://my_host.corp.example"], ""), credential("Local IPv6", &["http://[::1]:8080"], ""), credential("Evil", &["https://evil.com"], "")];
    for (url, expected) in [
        ("https://paypal.com./login", vec!["PayPal"]),
        ("https://www.paypal.com./", vec!["PayPal"]),
        ("blob:https://www.paypal.com/0b2c3d4e-0000-4000-8000-000000000000", vec!["PayPal"]),
        ("https://my_host.corp.example/login", vec!["Intranet"]),
        ("http://[::1]:8080/login", vec!["Local IPv6"]),
        ("http://[::2]:8080/login", vec![]),
        // The host is what follows the userinfo: the page is evil.com, not paypal.com.
        ("https://paypal.com@evil.com/", vec!["Evil"]),
        ("https://paypal.com:pw@evil.com/", vec!["Evil"]),
    ] {
        assert_eq!(names(&credentials, url, ""), expected, "{url}");
    }
    // URLs that match no credential never fall through to name matching, in no mode.
    for phishing_url in [
        "https://www_paypal.evil.com/",
        "https://paypal.evil.com./",
        "https://paypal.com@evil.com/",
        "https://[::1]:8080/paypal",
        "blob:https://paypal.evil.com/0b2c3d4e-0000-4000-8000-000000000000",
        "filesystem:https://paypal.evil.com/temporary/paypal",
        "data:text/html,paypal",
    ] {
        for (mode, output) in all_modes(&credentials[..2], phishing_url) {
            assert!(output.matched_ids.is_empty(), "{phishing_url} in {mode:?} mode must not match: {output:?}");
        }
    }
}

#[test]
fn results_are_capped_at_ten_by_default_or_at_the_requested_count() {
    let credentials: Vec<Credential> = (1..=12).map(|i| credential(&format!("Site {i}"), &[&format!("sub{i}.example.com")], "")).collect();
    assert_eq!(names(&credentials, "https://example.com", "").len(), 10);
    assert_eq!(filter_credentials(CredentialMatcherInput { max_results: Some(2), ..input(&credentials, "https://example.com", "") }).matched_ids.len(), 2);
}

#[test]
fn the_json_boundary_uses_camel_case() {
    let credentials = shared_credentials();
    let json = serde_json::to_string(&input(&credentials, "https://github.com", "")).unwrap();
    assert!(json.contains("\"currentUrl\"") && json.contains("\"matchingMode\""));
    let output_json = filter_credentials_json(&json).unwrap();
    assert!(output_json.contains("\"matchedIds\""));
    let output: CredentialMatcherOutput = serde_json::from_str(&output_json).unwrap();
    assert_eq!(credentials.iter().find(|c| c.id == output.matched_ids[0]).unwrap().item_name.as_deref(), Some("GitHub"));
}
