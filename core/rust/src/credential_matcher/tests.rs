//! Tests for credential matcher - ported from CredentialMatcher.test.ts

use super::*;

/// Helper function to create test credentials with standardized structure.
fn create_test_credential(item_name: &str, item_url: &str, username: &str) -> Credential {
    Credential {
        id: uuid_v4(),
        item_name: Some(item_name.to_string()),
        item_urls: if item_url.is_empty() {
            vec![]
        } else {
            vec![item_url.to_string()]
        },
        username: if username.is_empty() {
            None
        } else {
            Some(username.to_string())
        },
    }
}

/// Helper function to create test credentials with multiple URLs.
fn create_test_credential_multi_url(item_name: &str, item_urls: Vec<&str>, username: &str) -> Credential {
    Credential {
        id: uuid_v4(),
        item_name: Some(item_name.to_string()),
        item_urls: item_urls.into_iter().map(String::from).collect(),
        username: if username.is_empty() {
            None
        } else {
            Some(username.to_string())
        },
    }
}

/// Simple unique ID generator for tests using atomic counter
fn uuid_v4() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let id = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("test-id-{:016x}", id)
}

/// Creates the shared test credential dataset used across all platforms.
fn create_shared_test_credentials() -> Vec<Credential> {
    vec![
        create_test_credential("Gmail", "https://gmail.com", "user@gmail.com"),
        create_test_credential("Google", "https://google.com", "user@google.com"),
        create_test_credential("Coolblue", "https://www.coolblue.nl", "user@coolblue.nl"),
        create_test_credential("Amazon", "https://amazon.com", "user@amazon.com"),
        create_test_credential("Coolblue App", "com.coolblue.app", "user@coolblue.nl"),
        create_test_credential("Dumpert", "dumpert.nl", "user@dumpert.nl"),
        create_test_credential("GitHub", "github.com", "user@github.com"),
        create_test_credential("Stack Overflow", "https://stackoverflow.com", "user@stackoverflow.com"),
        create_test_credential("Subdomain Example", "https://app.example.com", "user@example.com"),
        create_test_credential("Title Only newyorktimes", "", ""),
        create_test_credential("Bank Account", "https://secure-bank.com", "user@bank.com"),
        create_test_credential("AliExpress", "https://aliexpress.com", "user@aliexpress.com"),
        create_test_credential("Reddit", "", "user@reddit.com"),
    ]
}

/// Helper to filter and return matched credentials by looking up IDs
fn filter(credentials: Vec<Credential>, current_url: &str, page_title: &str) -> Vec<Credential> {
    let input = CredentialMatcherInput {
        credentials: credentials.clone(),
        current_url: current_url.to_string(),
        page_title: page_title.to_string(),
        matching_mode: AutofillMatchingMode::Default,
        ignore_port: false,
    };
    let output = filter_credentials(input);

    // Look up credentials by matched IDs
    output.matched_ids
        .iter()
        .filter_map(|id| credentials.iter().find(|c| c.id == *id).cloned())
        .collect()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test cases ported from CredentialMatcher.test.ts
// ═══════════════════════════════════════════════════════════════════════════════

/// [#1] - Exact URL match
#[test]
fn test_exact_url_match() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "www.coolblue.nl", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].item_name.as_deref(), Some("Coolblue"));
}

/// [#2] - Base URL with path match
#[test]
fn test_base_url_with_path_match() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://gmail.com/signin", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].item_name.as_deref(), Some("Gmail"));
}

/// [#3] - Root domain with subdomain match
#[test]
fn test_root_domain_with_subdomain_match() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://mail.google.com", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].item_name.as_deref(), Some("Google"));
}

/// [#4] - No matches for non-existent domain
#[test]
fn test_no_matches_for_nonexistent_domain() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://nonexistent.com", "");

    assert_eq!(matches.len(), 0);
}

/// [#5] - Partial URL stored matches full URL search
#[test]
fn test_partial_url_matches_full_url() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://www.dumpert.nl", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].item_name.as_deref(), Some("Dumpert"));
}

/// [#6] - Full URL stored matches partial URL search
#[test]
fn test_full_url_matches_partial_url() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "coolblue.nl", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].item_name.as_deref(), Some("Coolblue"));
}

/// [#7] - Protocol variations (http/https/none) match
#[test]
fn test_protocol_variations() {
    let credentials = create_shared_test_credentials();

    let https_matches = filter(credentials.clone(), "https://github.com", "");
    let http_matches = filter(credentials.clone(), "http://github.com", "");
    let no_protocol_matches = filter(credentials, "github.com", "");

    assert_eq!(https_matches.len(), 1);
    assert_eq!(http_matches.len(), 1);
    assert_eq!(no_protocol_matches.len(), 1);
    assert_eq!(https_matches[0].item_name.as_deref(), Some("GitHub"));
    assert_eq!(http_matches[0].item_name.as_deref(), Some("GitHub"));
    assert_eq!(no_protocol_matches[0].item_name.as_deref(), Some("GitHub"));
}

/// [#8] - WWW prefix variations match
#[test]
fn test_www_variations() {
    let credentials = create_shared_test_credentials();

    let with_www = filter(credentials.clone(), "https://www.dumpert.nl", "");
    let without_www = filter(credentials, "https://dumpert.nl", "");

    assert_eq!(with_www.len(), 1);
    assert_eq!(without_www.len(), 1);
    assert_eq!(with_www[0].item_name.as_deref(), Some("Dumpert"));
    assert_eq!(without_www[0].item_name.as_deref(), Some("Dumpert"));
}

/// [#9] - Subdomain matching
#[test]
fn test_subdomain_matching() {
    let credentials = create_shared_test_credentials();

    let app_subdomain = filter(credentials.clone(), "https://app.example.com", "");
    let www_subdomain = filter(credentials.clone(), "https://www.example.com", "");
    let no_subdomain = filter(credentials, "https://example.com", "");

    assert_eq!(app_subdomain.len(), 1);
    assert_eq!(app_subdomain[0].item_name.as_deref(), Some("Subdomain Example"));
    assert_eq!(www_subdomain.len(), 1);
    assert_eq!(www_subdomain[0].item_name.as_deref(), Some("Subdomain Example"));
    assert_eq!(no_subdomain.len(), 1);
    assert_eq!(no_subdomain[0].item_name.as_deref(), Some("Subdomain Example"));
}

/// [#10] - Paths and query strings ignored
#[test]
fn test_paths_and_query_strings_ignored() {
    let credentials = create_shared_test_credentials();

    let with_path = filter(credentials.clone(), "https://github.com/user/repo", "");
    let with_query = filter(credentials.clone(), "https://stackoverflow.com/questions?tab=newest", "");
    let with_fragment = filter(credentials, "https://gmail.com#inbox", "");

    assert_eq!(with_path.len(), 1);
    assert_eq!(with_path[0].item_name.as_deref(), Some("GitHub"));
    assert_eq!(with_query.len(), 1);
    assert_eq!(with_query[0].item_name.as_deref(), Some("Stack Overflow"));
    assert_eq!(with_fragment.len(), 1);
    assert_eq!(with_fragment[0].item_name.as_deref(), Some("Gmail"));
}

/// [#11] - Complex URL variations
#[test]
fn test_complex_url_variations() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://www.coolblue.nl/product/12345?ref=google", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].item_name.as_deref(), Some("Coolblue"));
}

/// [#12] - Priority ordering
#[test]
fn test_priority_ordering() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "coolblue.nl", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].item_name.as_deref(), Some("Coolblue"));
}

/// [#13] - Title-only matching
#[test]
fn test_title_only_matching() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://nomatch.com", "newyorktimes");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].item_name.as_deref(), Some("Title Only newyorktimes"));
}

/// [#14] - Domain name part matching
#[test]
fn test_domain_name_part_matching() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://coolblue.be", "");

    // coolblue.be should NOT match coolblue.nl
    assert_eq!(matches.len(), 0);
}

/// [#15] - Package name matching
#[test]
fn test_package_name_matching() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "com.coolblue.app", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].item_name.as_deref(), Some("Coolblue App"));
}

/// [#16] - Invalid URL handling
#[test]
fn test_invalid_url_handling() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "not a url", "");

    assert_eq!(matches.len(), 0);
}

/// [#17] - Anti-phishing protection
#[test]
fn test_anti_phishing_protection() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://secure-bankk.com", "");

    // Should NOT match secure-bank.com (different domain)
    assert_eq!(matches.len(), 0);
}

/// [#18] - Ensure only full words are matched
#[test]
fn test_full_word_matching_only() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "", "Express Yourself App | Description");

    // The string above should not match "AliExpress" service name
    assert_eq!(matches.len(), 0);
}

/// [#19] - Ensure separators and punctuation are stripped for matching
#[test]
fn test_separators_and_punctuation_stripped() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://nomatch.com", "Reddit, social media platform");

    // Should match "Reddit" even though it's followed by a comma and description
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].item_name.as_deref(), Some("Reddit"));
}

/// [#20] - Test reversed domain (app package name) doesn't match on TLD
#[test]
fn test_reversed_domain_no_tld_match() {
    let credentials = vec![
        create_test_credential("Dumpert.nl", "", "user@dumpert.nl"),
        create_test_credential("Marktplaats.nl", "", "user@marktplaats.nl"),
    ];

    let matches = filter(credentials, "nl.marktplaats.android", "");

    // Should only match Marktplaats, not Dumpert (even though both have "nl")
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].item_name.as_deref(), Some("Marktplaats.nl"));
}

/// [#21] - Test app package names are properly detected and handled
#[test]
fn test_app_package_names_handling() {
    let credentials = vec![
        create_test_credential("Google App", "com.google.android.googlequicksearchbox", "user@google.com"),
        create_test_credential("Facebook", "com.facebook.katana", "user@facebook.com"),
        create_test_credential("WhatsApp", "com.whatsapp", "user@whatsapp.com"),
        create_test_credential("Generic Site", "example.com", "user@example.com"),
    ];

    // Test com.google.android package matches
    let google_matches = filter(credentials.clone(), "com.google.android.googlequicksearchbox", "");
    assert_eq!(google_matches.len(), 1);
    assert_eq!(google_matches[0].item_name.as_deref(), Some("Google App"));

    // Test com.facebook package matches
    let facebook_matches = filter(credentials.clone(), "com.facebook.katana", "");
    assert_eq!(facebook_matches.len(), 1);
    assert_eq!(facebook_matches[0].item_name.as_deref(), Some("Facebook"));

    // Test that web domain doesn't match package name
    let web_matches = filter(credentials, "https://example.com", "");
    assert_eq!(web_matches.len(), 1);
    assert_eq!(web_matches[0].item_name.as_deref(), Some("Generic Site"));
}

/// [#22] - Test multi-part TLDs like .com.au don't match incorrectly
#[test]
fn test_multi_part_tlds() {
    let credentials = vec![
        create_test_credential("Example Site AU", "https://example.com.au", "user@example.com.au"),
        create_test_credential("BlaBla AU", "https://blabla.blabla.com.au", "user@blabla.com.au"),
        create_test_credential("Another AU", "https://another.com.au", "user@another.com.au"),
        create_test_credential("UK Site", "https://example.co.uk", "user@example.co.uk"),
    ];

    // Test that blabla.blabla.com.au doesn't match other .com.au sites
    let blabla_matches = filter(credentials.clone(), "https://blabla.blabla.com.au", "");
    assert_eq!(blabla_matches.len(), 1);
    assert_eq!(blabla_matches[0].item_name.as_deref(), Some("BlaBla AU"));

    // Test that example.com.au doesn't match blabla.blabla.com.au
    let example_matches = filter(credentials.clone(), "https://example.com.au", "");
    assert_eq!(example_matches.len(), 1);
    assert_eq!(example_matches[0].item_name.as_deref(), Some("Example Site AU"));

    // Test that .co.uk domains work correctly too
    let uk_matches = filter(credentials, "https://example.co.uk", "");
    assert_eq!(uk_matches.len(), 1);
    assert_eq!(uk_matches[0].item_name.as_deref(), Some("UK Site"));
}

/// Test JSON serialization/deserialization
#[test]
fn test_json_roundtrip() {
    let credentials = create_shared_test_credentials();
    let input = CredentialMatcherInput {
        credentials: credentials.clone(),
        current_url: "https://github.com".to_string(),
        page_title: String::new(),
        matching_mode: AutofillMatchingMode::Default,
        ignore_port: false,
    };

    let json = serde_json::to_string(&input).unwrap();
    let output_json = filter_credentials_json(&json).unwrap();
    let output: CredentialMatcherOutput = serde_json::from_str(&output_json).unwrap();

    assert_eq!(output.matched_ids.len(), 1);
    // Look up the credential by ID to verify it's GitHub
    let matched = credentials.iter().find(|c| c.id == output.matched_ids[0]).unwrap();
    assert_eq!(matched.item_name.as_deref(), Some("GitHub"));
}

/// Test empty URL returns empty results
#[test]
fn test_empty_url() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "", "");

    assert_eq!(matches.len(), 0);
}

/// Test max 3 results returned
#[test]
fn test_max_three_results() {
    let credentials = vec![
        create_test_credential("Site 1", "example.com", ""),
        create_test_credential("Site 2", "sub1.example.com", ""),
        create_test_credential("Site 3", "sub2.example.com", ""),
        create_test_credential("Site 4", "sub3.example.com", ""),
        create_test_credential("Site 5", "sub4.example.com", ""),
    ];

    let matches = filter(credentials, "https://example.com", "");

    // Should return max 3 results
    assert!(matches.len() <= 3);
}

/// [#23] - E2E test scenario: credentials with URLs should only match their specific domains
/// This mirrors the browser extension E2E test setup
#[test]
fn test_e2e_scenario_url_only_matching() {
    let credentials = vec![
        create_test_credential("Example Site", "https://example.com/login", "user@example.com"),
        create_test_credential("Example Subdomain", "https://test.example.com/auth", "admin@example.com"),
        create_test_credential("Another Site", "https://another-example.com/signin", "user@another.com"),
    ];

    // Test 1: Unrelated domain should return NO matches
    let unrelated_matches = filter(credentials.clone(), "https://unrelated-domain.com/login", "E2E Test Form");
    assert_eq!(unrelated_matches.len(), 0, "Unrelated domain should not match any credentials");

    // Test 2: example.com should only match Example Site (and possibly subdomain due to root domain matching)
    let example_matches = filter(credentials.clone(), "https://example.com/login", "E2E Test Form");
    println!("example.com matches: {:?}", example_matches.iter().map(|c| c.item_name.as_deref()).collect::<Vec<_>>());
    assert!(example_matches.len() >= 1, "example.com should match at least one credential");
    assert!(example_matches.iter().any(|c| c.item_name.as_deref() == Some("Example Site")),
        "example.com should match Example Site");
    assert!(!example_matches.iter().any(|c| c.item_name.as_deref() == Some("Another Site")),
        "example.com should NOT match Another Site");

    // Test 3: another-example.com should only match Another Site
    let another_matches = filter(credentials.clone(), "https://another-example.com/signin", "E2E Test Form");
    assert_eq!(another_matches.len(), 1, "another-example.com should match exactly one credential");
    assert_eq!(another_matches[0].item_name.as_deref(), Some("Another Site"));

    // Test 4: test.example.com subdomain should match Example Subdomain
    let subdomain_matches = filter(credentials, "https://test.example.com/auth", "E2E Test Form");
    assert!(subdomain_matches.len() >= 1, "test.example.com should match at least one credential");
    assert!(subdomain_matches.iter().any(|c| c.item_name.as_deref() == Some("Example Subdomain")),
        "test.example.com should match Example Subdomain");
    assert!(!subdomain_matches.iter().any(|c| c.item_name.as_deref() == Some("Another Site")),
        "test.example.com should NOT match Another Site");
}

/// [#24] - Multi-URL support: credentials with multiple URLs should match any of them
#[test]
fn test_multi_url_matching() {
    let credentials = vec![
        create_test_credential_multi_url(
            "Vodafone",
            vec!["https://www.vodafone.com", "https://my.vodafone.de", "https://www.vodafone.nl"],
            "user@vodafone.com"
        ),
        create_test_credential("Other Site", "https://example.com", "user@example.com"),
    ];

    // Test 1: First URL should match
    let first_url_matches = filter(credentials.clone(), "https://www.vodafone.com/account", "");
    assert_eq!(first_url_matches.len(), 1);
    assert_eq!(first_url_matches[0].item_name.as_deref(), Some("Vodafone"));

    // Test 2: Second URL should match
    let second_url_matches = filter(credentials.clone(), "https://my.vodafone.de/login", "");
    assert_eq!(second_url_matches.len(), 1);
    assert_eq!(second_url_matches[0].item_name.as_deref(), Some("Vodafone"));

    // Test 3: Third URL should match (this was the original bug!)
    let third_url_matches = filter(credentials.clone(), "https://www.vodafone.nl/inloggen", "");
    assert_eq!(third_url_matches.len(), 1, "Third URL should match");
    assert_eq!(third_url_matches[0].item_name.as_deref(), Some("Vodafone"));

    // Test 4: Subdomain of any URL should match
    let subdomain_matches = filter(credentials.clone(), "https://portal.vodafone.nl", "");
    assert_eq!(subdomain_matches.len(), 1);
    assert_eq!(subdomain_matches[0].item_name.as_deref(), Some("Vodafone"));

    // Test 5: Unrelated domain should not match
    let unrelated_matches = filter(credentials, "https://vodafone.be", "");
    assert_eq!(unrelated_matches.len(), 0);
}

/// [#25] - Multi-URL with exact match priority: exact match on any URL beats subdomain match
#[test]
fn test_multi_url_exact_match_priority() {
    let credentials = vec![
        create_test_credential_multi_url(
            "Site with subdomain first",
            vec!["https://app.example.com", "https://example.org"],
            "user@example.com"
        ),
    ];

    // Searching example.org should be exact match (priority 1), not subdomain match
    let input = CredentialMatcherInput {
        credentials: credentials.clone(),
        current_url: "https://example.org".to_string(),
        page_title: String::new(),
        matching_mode: AutofillMatchingMode::Default,
        ignore_port: false,
    };
    let output = filter_credentials(input);

    assert_eq!(output.matched_ids.len(), 1);
    assert_eq!(output.matched_priority, 2); // Priority 2 = URL domain matching
}

/// [#26] - Multi-URL app package matching
#[test]
fn test_multi_url_app_package_matching() {
    let credentials = vec![
        create_test_credential_multi_url(
            "Coolblue",
            vec!["https://www.coolblue.nl", "com.coolblue.app", "nl.coolblue.ios"],
            "user@coolblue.nl"
        ),
    ];

    // Web URL should match
    let web_matches = filter(credentials.clone(), "https://coolblue.nl", "");
    assert_eq!(web_matches.len(), 1);
    assert_eq!(web_matches[0].item_name.as_deref(), Some("Coolblue"));

    // Android package should match
    let android_matches = filter(credentials.clone(), "com.coolblue.app", "");
    assert_eq!(android_matches.len(), 1);
    assert_eq!(android_matches[0].item_name.as_deref(), Some("Coolblue"));

    // iOS package should match
    let ios_matches = filter(credentials, "nl.coolblue.ios", "");
    assert_eq!(ios_matches.len(), 1);
    assert_eq!(ios_matches[0].item_name.as_deref(), Some("Coolblue"));
}

/// [#27] - URLs with port numbers should match correctly
#[test]
fn test_url_with_port_matching() {
    let credentials = vec![
        create_test_credential("Local Dev", "https://dev.local:3000", "dev@local.com"),
        create_test_credential("Staging Server", "https://staging.example.com:8080", "user@staging.com"),
        create_test_credential("Production", "https://example.com", "user@example.com"),
    ];

    // URL with port should match credential with same URL+port
    let local_matches = filter(credentials.clone(), "https://dev.local:3000/login", "");
    assert_eq!(local_matches.len(), 1);
    assert_eq!(local_matches[0].item_name.as_deref(), Some("Local Dev"));

    // URL with different port should still match domain (subdomain matching)
    let staging_matches = filter(credentials.clone(), "https://staging.example.com:8080/dashboard", "");
    assert_eq!(staging_matches.len(), 1);
    assert_eq!(staging_matches[0].item_name.as_deref(), Some("Staging Server"));

    // Production URL should match production credential
    let prod_matches = filter(credentials, "https://example.com/app", "");
    assert_eq!(prod_matches.len(), 1);
    assert_eq!(prod_matches[0].item_name.as_deref(), Some("Production"));
}

/// [#28] - Exact match exclusivity: when exact URL match exists, subdomain matches should be excluded
#[test]
fn test_exact_match_excludes_subdomain_matches() {
    let credentials = vec![
        create_test_credential("Exact Match Site", "https://blabla.asd.com", "user@blabla.com"),
        create_test_credential("Root Domain", "https://asd.com", "user@asd.com"),
        create_test_credential("Other Subdomain", "https://bloe.asd.com", "user@bloe.com"),
    ];

    // When visiting blabla.asd.com, only the exact match should be shown
    // NOT the root domain (asd.com) or other subdomains (bloe.asd.com)
    let matches = filter(credentials.clone(), "https://blabla.asd.com/page", "");
    assert_eq!(matches.len(), 1, "Should only return the exact match, not subdomain matches");
    assert_eq!(matches[0].item_name.as_deref(), Some("Exact Match Site"));

    // When visiting asd.com (root), only root domain credential should match
    let root_matches = filter(credentials.clone(), "https://asd.com/login", "");
    assert_eq!(root_matches.len(), 1, "Root domain should only match exact root credential");
    assert_eq!(root_matches[0].item_name.as_deref(), Some("Root Domain"));

    // When visiting bloe.asd.com, only that subdomain should match
    let bloe_matches = filter(credentials, "https://bloe.asd.com/app", "");
    assert_eq!(bloe_matches.len(), 1, "Subdomain should only match exact subdomain credential");
    assert_eq!(bloe_matches[0].item_name.as_deref(), Some("Other Subdomain"));
}

/// [#29] - Port-aware matching: exact domain+port beats exact domain beats subdomain
#[test]
fn test_port_aware_matching_priority() {
    // Scenario: Self-hosted user with multiple services on same domain but different ports
    let credentials = vec![
        create_test_credential("Service A (Port 8080)", "https://myserver.local:8080", "admin@servicea.com"),
        create_test_credential("Service B (Port 9000)", "https://myserver.local:9000", "admin@serviceb.com"),
        create_test_credential("Service C (No Port)", "https://myserver.local", "admin@servicec.com"),
    ];

    // When visiting myserver.local:8080, ONLY the port 8080 credential should match
    let port_8080_matches = filter(credentials.clone(), "https://myserver.local:8080/dashboard", "");
    assert_eq!(port_8080_matches.len(), 1, "Should only return exact domain+port match");
    assert_eq!(port_8080_matches[0].item_name.as_deref(), Some("Service A (Port 8080)"));

    // When visiting myserver.local:9000, ONLY the port 9000 credential should match
    let port_9000_matches = filter(credentials.clone(), "https://myserver.local:9000/api", "");
    assert_eq!(port_9000_matches.len(), 1, "Should only return exact domain+port match");
    assert_eq!(port_9000_matches[0].item_name.as_deref(), Some("Service B (Port 9000)"));

    // When visiting myserver.local (no port), ONLY the no-port credential should match
    let no_port_matches = filter(credentials.clone(), "https://myserver.local/home", "");
    assert_eq!(no_port_matches.len(), 1, "Should only return exact domain match (no port)");
    assert_eq!(no_port_matches[0].item_name.as_deref(), Some("Service C (No Port)"));

    // When visiting myserver.local:5000 (port not matching any credential),
    // all credentials with exact domain match (priority 2) should be returned (up to 3)
    // This is expected behavior - when no exact port match exists, we show all domain matches
    let diff_port_matches = filter(credentials, "https://myserver.local:5000/new", "");
    assert_eq!(diff_port_matches.len(), 3, "Should return all domain matches when no exact port match");
}

/// [#30] - Port numbers in URL should still allow exact matching with subdomain fallback
#[test]
fn test_port_url_exact_match_exclusivity() {
    let credentials = vec![
        create_test_credential("Exact Port Site", "https://blabla.asd.com:1234", "user@blabla.com"),
        create_test_credential("Root Domain", "https://asd.com", "user@asd.com"),
        create_test_credential("Other Subdomain", "https://bloe.asd.com", "user@bloe.com"),
    ];

    // When visiting blabla.asd.com:1234, only the exact domain+port match should be shown
    let matches = filter(credentials.clone(), "https://blabla.asd.com:1234/page", "");
    assert_eq!(matches.len(), 1, "Should only return the exact domain+port match");
    assert_eq!(matches[0].item_name.as_deref(), Some("Exact Port Site"));

    // When visiting blabla.asd.com (no port), should match via domain-only (priority 2)
    // since we have a credential with same domain (but different port)
    let no_port_matches = filter(credentials, "https://blabla.asd.com/page", "");
    assert_eq!(no_port_matches.len(), 1, "Should match domain-only when port differs");
    assert_eq!(no_port_matches[0].item_name.as_deref(), Some("Exact Port Site"));
}

/// [#31] - When no exact match exists, subdomain matching should still work
#[test]
fn test_subdomain_matching_without_exact() {
    let credentials = vec![
        create_test_credential("Root Domain Only", "https://example.com", "user@example.com"),
    ];

    // Visiting a subdomain should match the root domain credential (subdomain matching)
    let subdomain_matches = filter(credentials.clone(), "https://app.example.com/login", "");
    assert_eq!(subdomain_matches.len(), 1, "Subdomain should match root domain when no exact match exists");
    assert_eq!(subdomain_matches[0].item_name.as_deref(), Some("Root Domain Only"));

    // Visiting another subdomain should also match
    let another_subdomain = filter(credentials, "https://api.example.com/v1", "");
    assert_eq!(another_subdomain.len(), 1);
    assert_eq!(another_subdomain[0].item_name.as_deref(), Some("Root Domain Only"));
}

/// [#32] - Multiple credentials with same domain but different ports
#[test]
fn test_multiple_same_domain_different_ports() {
    let credentials = vec![
        create_test_credential("Portainer", "https://server.home:9443", "admin@portainer"),
        create_test_credential("Nextcloud", "https://server.home:8443", "admin@nextcloud"),
        create_test_credential("Home Assistant", "https://server.home:8123", "admin@hass"),
        create_test_credential("Main Site", "https://server.home", "admin@main"),
    ];

    // Each port should only match its specific credential
    let portainer = filter(credentials.clone(), "https://server.home:9443", "");
    assert_eq!(portainer.len(), 1);
    assert_eq!(portainer[0].item_name.as_deref(), Some("Portainer"));

    let nextcloud = filter(credentials.clone(), "https://server.home:8443", "");
    assert_eq!(nextcloud.len(), 1);
    assert_eq!(nextcloud[0].item_name.as_deref(), Some("Nextcloud"));

    let hass = filter(credentials.clone(), "https://server.home:8123", "");
    assert_eq!(hass.len(), 1);
    assert_eq!(hass[0].item_name.as_deref(), Some("Home Assistant"));

    let main = filter(credentials, "https://server.home", "");
    assert_eq!(main.len(), 1);
    assert_eq!(main[0].item_name.as_deref(), Some("Main Site"));
}

/// [#33] - User's exact scenario: URL with port should ONLY match exact URL, not items named after domain
#[test]
fn test_user_scenario_url_with_port_vs_named_items() {
    // User has:
    // 1. An item with exact URL https://blabla.asd.com:1234
    // 2. Items named "asd.com" and "bloe.asd.com" (possibly with URLs to those domains)
    let credentials = vec![
        create_test_credential("blabla.asd.com service", "https://blabla.asd.com:1234", "user@blabla.com"),
        create_test_credential("asd.com", "https://asd.com", "user@asd.com"),
        create_test_credential("bloe.asd.com", "https://bloe.asd.com", "user@bloe.com"),
    ];

    // When visiting https://blabla.asd.com:1234, ONLY the exact match should be returned
    let matches = filter(credentials.clone(), "https://blabla.asd.com:1234/some/path", "Some Page Title");

    // This should return ONLY 1 credential - the exact domain+port match
    assert_eq!(matches.len(), 1, "Should ONLY return the exact domain+port match, not subdomain matches");
    assert_eq!(matches[0].item_name.as_deref(), Some("blabla.asd.com service"));

    // Double-check: items with URLs should NOT be matched via title/name
    // because we already have a URL match (which takes priority)
}

/// [#34] - Items WITHOUT URLs should NOT match when URL match exists
#[test]
fn test_items_without_urls_not_matched_when_url_match_exists() {
    let credentials = vec![
        create_test_credential("blabla service", "https://blabla.asd.com:1234", "user@blabla.com"),
        // These items have NO URLs - they should NOT be matched via title when URL match exists
        create_test_credential("asd", "", "user@asd.com"),
        create_test_credential("blabla", "", "user@blabla.com"),
    ];

    // When visiting blabla.asd.com:1234, only the URL match should be returned
    // The items named "asd" and "blabla" should NOT match even though page title might contain those words
    let matches = filter(credentials.clone(), "https://blabla.asd.com:1234/login", "Welcome to blabla asd service");

    assert_eq!(matches.len(), 1, "Should only return URL match, not title matches");
    assert_eq!(matches[0].item_name.as_deref(), Some("blabla service"));
}

/// [#35] - Items WITHOUT URLs should match via URL-derived word matching on item name
#[test]
fn test_items_without_urls_matched_by_url_domain_words() {
    let credentials = vec![
        create_test_credential("Test Dumpert", "", "user@dumpert.nl"),
        create_test_credential("Some Other Item", "", "user@other.com"),
    ];

    // When visiting dumpert.nl with no page title, the credential named "Test Dumpert"
    // should still match because "dumpert" from the URL matches "dumpert" in the item name
    let matches = filter(credentials, "https://www.dumpert.nl", "");

    assert_eq!(matches.len(), 1, "Should match credential by URL-derived word against item name");
    assert_eq!(matches[0].item_name.as_deref(), Some("Test Dumpert"));
}

/// [#36] - URL-derived word matching should NOT match credentials that have URLs defined
#[test]
fn test_url_word_matching_skips_credentials_with_urls() {
    let credentials = vec![
        // This credential HAS a URL (different domain) - should NOT match via name
        create_test_credential("Test Dumpert", "https://other-site.com", "user@dumpert.nl"),
        // This credential has NO URL - should match via name
        create_test_credential("Dumpert Account", "", "user@dumpert.nl"),
    ];

    let matches = filter(credentials, "https://www.dumpert.nl", "");

    assert_eq!(matches.len(), 1, "Should only match the credential without URLs");
    assert_eq!(matches[0].item_name.as_deref(), Some("Dumpert Account"));
}

/// Helper to filter with ignore_port flag (for Android-style matching)
fn filter_ignore_port(credentials: Vec<Credential>, current_url: &str, page_title: &str) -> Vec<Credential> {
    let input = CredentialMatcherInput {
        credentials: credentials.clone(),
        current_url: current_url.to_string(),
        page_title: page_title.to_string(),
        matching_mode: AutofillMatchingMode::Default,
        ignore_port: true,
    };
    let output = filter_credentials(input);

    output.matched_ids
        .iter()
        .filter_map(|id| credentials.iter().find(|c| c.id == *id).cloned())
        .collect()
}

/// [#37] - ignore_port flag: Android scenario where port info is unavailable
/// When Android sends URL without port, it should still match credentials with ports
#[test]
fn test_ignore_port_android_scenario() {
    let credentials = vec![
        create_test_credential("Service A (Port 8080)", "https://myserver.local:8080", "admin@a"),
        create_test_credential("Service B (Port 9000)", "https://myserver.local:9000", "admin@b"),
        create_test_credential("Service C (No Port)", "https://myserver.local", "admin@c"),
    ];

    // Without ignore_port: visiting myserver.local (no port) only matches the no-port credential
    let normal_matches = filter(credentials.clone(), "https://myserver.local/home", "");
    assert_eq!(normal_matches.len(), 1, "Normal matching should only return no-port credential");
    assert_eq!(normal_matches[0].item_name.as_deref(), Some("Service C (No Port)"));

    // With ignore_port: visiting myserver.local (no port) matches ALL credentials with same domain
    // This simulates Android's autofill where port info is stripped by the OS
    let android_matches = filter_ignore_port(credentials.clone(), "https://myserver.local/home", "");
    assert_eq!(android_matches.len(), 3, "ignore_port should match all domain credentials regardless of port");
}

/// [#38] - ignore_port flag: IP address with port scenario
/// Common for self-hosted services accessed via IP:port
#[test]
fn test_ignore_port_ip_address_scenario() {
    let credentials = vec![
        create_test_credential("Home Assistant", "https://192.168.1.100:8123", "admin@ha"),
        create_test_credential("Portainer", "https://192.168.1.100:9443", "admin@portainer"),
        create_test_credential("Router Admin", "https://192.168.1.1", "admin@router"),
    ];

    // Android sends just the IP without port
    let matches = filter_ignore_port(credentials.clone(), "https://192.168.1.100", "");

    // Should match both services on 192.168.1.100, regardless of their stored ports
    assert_eq!(matches.len(), 2, "Should match all credentials for the IP address");

    // Verify it doesn't match the different IP
    let router_matches = filter_ignore_port(credentials.clone(), "https://192.168.1.1", "");
    assert_eq!(router_matches.len(), 1);
    assert_eq!(router_matches[0].item_name.as_deref(), Some("Router Admin"));
}

/// [#39] - ignore_port should not affect subdomain matching
#[test]
fn test_ignore_port_with_subdomain_matching() {
    let credentials = vec![
        create_test_credential("App Portal", "https://app.example.com:8080", "user@app"),
        create_test_credential("Main Site", "https://example.com", "user@main"),
    ];

    // With ignore_port, subdomain matching should still work
    let matches = filter_ignore_port(credentials.clone(), "https://api.example.com", "");

    // Should match both via subdomain/root domain matching
    assert_eq!(matches.len(), 2, "Subdomain matching should still work with ignore_port");
}

/// [#40] - ignore_port flag: IP address with multiple ports and one without port
/// Tests the exact scenario: 4 credentials on same IP (3 with ports, 1 without)
/// Without flag: visiting IP without port should only match the no-port credential
/// With flag: visiting IP without port should match all 4 credentials
#[test]
fn test_ignore_port_ip_with_multiple_ports_and_no_port() {
    let credentials = vec![
        create_test_credential("Service on 5000", "https://192.168.1.10:5000", "admin@5000"),
        create_test_credential("Service on 6000", "https://192.168.1.10:6000", "admin@6000"),
        create_test_credential("Service on 7000", "https://192.168.1.10:7000", "admin@7000"),
        create_test_credential("Service no port", "https://192.168.1.10", "admin@noport"),
    ];

    // WITHOUT ignore_port flag (normal browser behavior):
    // Visiting 192.168.1.10 (no port) should ONLY match the credential without port
    // because we have an exact domain+port match (both have no port)
    let normal_matches = filter(credentials.clone(), "https://192.168.1.10", "");
    assert_eq!(normal_matches.len(), 1, "Without ignore_port, should only match the no-port credential");
    assert_eq!(normal_matches[0].item_name.as_deref(), Some("Service no port"));

    // WITH ignore_port flag (Android behavior where port is stripped):
    // Visiting 192.168.1.10 (no port) should match ALL 4 credentials
    // because we ignore port differences entirely
    let android_matches = filter_ignore_port(credentials.clone(), "https://192.168.1.10", "");
    assert_eq!(android_matches.len(), 3, "With ignore_port, should match all 4 credentials (max 3 returned)");

    // Note: max 3 results are returned, but all 4 would match if limit was higher
    // Let's verify with a smaller set that all match
    let small_credentials = vec![
        create_test_credential("Service on 5000", "https://192.168.1.10:5000", "admin@5000"),
        create_test_credential("Service no port", "https://192.168.1.10", "admin@noport"),
    ];

    let small_normal = filter(small_credentials.clone(), "https://192.168.1.10", "");
    assert_eq!(small_normal.len(), 1, "Without ignore_port, only no-port matches");
    assert_eq!(small_normal[0].item_name.as_deref(), Some("Service no port"));

    let small_android = filter_ignore_port(small_credentials.clone(), "https://192.168.1.10", "");
    assert_eq!(small_android.len(), 2, "With ignore_port, both credentials match");
}

/// [#41] - Localhost matching with ports (development scenarios)
/// Common scenario: developers running multiple services on localhost with different ports
#[test]
fn test_localhost_matching_with_ports() {
    let credentials = vec![
        create_test_credential("Local API", "http://localhost:3000", "dev@api"),
        create_test_credential("Local Frontend", "http://localhost:8080", "dev@frontend"),
        create_test_credential("Local Backend", "http://localhost:81", "dev@backend"),
        create_test_credential("Local No Port", "http://localhost", "dev@default"),
    ];

    // Visiting localhost:81 should only match the :81 credential
    let matches_81 = filter(credentials.clone(), "http://localhost:81", "");
    assert_eq!(matches_81.len(), 1, "Should only return exact localhost:81 match");
    assert_eq!(matches_81[0].item_name.as_deref(), Some("Local Backend"));

    // Visiting localhost:3000 should only match the :3000 credential
    let matches_3000 = filter(credentials.clone(), "http://localhost:3000", "");
    assert_eq!(matches_3000.len(), 1, "Should only return exact localhost:3000 match");
    assert_eq!(matches_3000[0].item_name.as_deref(), Some("Local API"));

    // Visiting localhost:8080 should only match the :8080 credential
    let matches_8080 = filter(credentials.clone(), "http://localhost:8080", "");
    assert_eq!(matches_8080.len(), 1, "Should only return exact localhost:8080 match");
    assert_eq!(matches_8080[0].item_name.as_deref(), Some("Local Frontend"));

    // Visiting localhost (no port) should only match the no-port credential
    let matches_no_port = filter(credentials.clone(), "http://localhost", "");
    assert_eq!(matches_no_port.len(), 1, "Should only return localhost without port match");
    assert_eq!(matches_no_port[0].item_name.as_deref(), Some("Local No Port"));

    // Visiting localhost with a port not in credentials should show domain matches (up to 3)
    let matches_unknown_port = filter(credentials.clone(), "http://localhost:5000", "");
    assert_eq!(matches_unknown_port.len(), 3, "Should return domain matches when no exact port match");
}

/// [#42] - Localhost matching - exact URL stored
/// User's specific scenario: credential with exactly "http://localhost:81" should match
#[test]
fn test_localhost_exact_url_stored() {
    let credentials = vec![
        create_test_credential("My Local Service", "http://localhost:81", "user@local"),
    ];

    // Should match when visiting exactly http://localhost:81
    let matches = filter(credentials.clone(), "http://localhost:81", "");
    assert_eq!(matches.len(), 1, "Should match exact localhost:81 URL");
    assert_eq!(matches[0].item_name.as_deref(), Some("My Local Service"));

    // Should also match with path
    let matches_with_path = filter(credentials.clone(), "http://localhost:81/some/path", "");
    assert_eq!(matches_with_path.len(), 1, "Should match localhost:81 with path");

    // Should also match with query string
    let matches_with_query = filter(credentials.clone(), "http://localhost:81?debug=true", "");
    assert_eq!(matches_with_query.len(), 1, "Should match localhost:81 with query");
}

/// [#43] - Single-word hostname matching (homelab/self-hosted scenarios)
/// Common scenario: self-hosted services with local DNS or /etc/hosts entries
/// like "plex", "nas", "router", "homeassistant", etc.
#[test]
fn test_single_word_hostname_matching() {
    let credentials = vec![
        create_test_credential("Plex Media Server", "http://plex:32400", "admin@plex"),
        create_test_credential("Synology NAS", "https://nas:5001", "admin@nas"),
        create_test_credential("Pi-hole", "http://pihole/admin", "admin@pihole"),
        create_test_credential("Home Assistant", "http://homeassistant:8123", "admin@ha"),
        create_test_credential("Router Admin", "http://router", "admin@router"),
    ];

    // Plex with exact port
    let plex_matches = filter(credentials.clone(), "http://plex:32400", "");
    assert_eq!(plex_matches.len(), 1, "Should match plex:32400");
    assert_eq!(plex_matches[0].item_name.as_deref(), Some("Plex Media Server"));

    // Plex with path
    let plex_path = filter(credentials.clone(), "http://plex:32400/web/index.html", "");
    assert_eq!(plex_path.len(), 1, "Should match plex:32400 with path");

    // NAS with HTTPS
    let nas_matches = filter(credentials.clone(), "https://nas:5001", "");
    assert_eq!(nas_matches.len(), 1, "Should match nas:5001");
    assert_eq!(nas_matches[0].item_name.as_deref(), Some("Synology NAS"));

    // Pi-hole with path
    let pihole_matches = filter(credentials.clone(), "http://pihole/admin/index.php", "");
    assert_eq!(pihole_matches.len(), 1, "Should match pihole with path");
    assert_eq!(pihole_matches[0].item_name.as_deref(), Some("Pi-hole"));

    // Home Assistant
    let ha_matches = filter(credentials.clone(), "http://homeassistant:8123/dashboard", "");
    assert_eq!(ha_matches.len(), 1, "Should match homeassistant:8123");
    assert_eq!(ha_matches[0].item_name.as_deref(), Some("Home Assistant"));

    // Router without port
    let router_matches = filter(credentials.clone(), "http://router", "");
    assert_eq!(router_matches.len(), 1, "Should match router without port");
    assert_eq!(router_matches[0].item_name.as_deref(), Some("Router Admin"));

    // Router with different port should still match via domain
    let router_port = filter(credentials.clone(), "http://router:8080", "");
    assert_eq!(router_port.len(), 1, "Should match router with different port via domain match");
}

/// [#44] - Single-word hostnames require protocol for extraction
/// Credentials stored WITH protocol should match current URLs with protocol.
/// Note: Browser always sends URLs with protocol, so this mainly affects
/// what URLs can be stored in credentials.
#[test]
fn test_single_word_hostname_extraction_requires_protocol() {
    // Credential stored WITHOUT protocol - should NOT be matchable
    let credentials_no_protocol = vec![
        create_test_credential("Plex No Protocol", "plex:32400", "admin@plex"),
    ];

    // Even with protocol in current URL, credential without protocol won't match
    // because the credential URL "plex:32400" can't be extracted as a domain
    let no_match = filter(credentials_no_protocol.clone(), "http://plex:32400", "");
    assert_eq!(no_match.len(), 0, "Credential without protocol should not be matchable");

    // Credential stored WITH protocol - should match
    let credentials_with_protocol = vec![
        create_test_credential("Plex With Protocol", "http://plex:32400", "admin@plex"),
    ];

    let with_match = filter(credentials_with_protocol.clone(), "http://plex:32400", "");
    assert_eq!(with_match.len(), 1, "Credential with protocol should match");
}
