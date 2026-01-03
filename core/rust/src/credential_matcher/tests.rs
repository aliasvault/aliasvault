//! Tests for credential matcher - ported from CredentialMatcher.test.ts

use super::*;

/// Helper function to create test credentials with standardized structure.
fn create_test_credential(service_name: &str, service_url: &str, username: &str) -> Credential {
    Credential {
        id: uuid_v4(),
        service_name: Some(service_name.to_string()),
        service_url: if service_url.is_empty() {
            None
        } else {
            Some(service_url.to_string())
        },
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
    assert_eq!(matches[0].service_name.as_deref(), Some("Coolblue"));
}

/// [#2] - Base URL with path match
#[test]
fn test_base_url_with_path_match() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://gmail.com/signin", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].service_name.as_deref(), Some("Gmail"));
}

/// [#3] - Root domain with subdomain match
#[test]
fn test_root_domain_with_subdomain_match() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://mail.google.com", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].service_name.as_deref(), Some("Google"));
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
    assert_eq!(matches[0].service_name.as_deref(), Some("Dumpert"));
}

/// [#6] - Full URL stored matches partial URL search
#[test]
fn test_full_url_matches_partial_url() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "coolblue.nl", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].service_name.as_deref(), Some("Coolblue"));
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
    assert_eq!(https_matches[0].service_name.as_deref(), Some("GitHub"));
    assert_eq!(http_matches[0].service_name.as_deref(), Some("GitHub"));
    assert_eq!(no_protocol_matches[0].service_name.as_deref(), Some("GitHub"));
}

/// [#8] - WWW prefix variations match
#[test]
fn test_www_variations() {
    let credentials = create_shared_test_credentials();

    let with_www = filter(credentials.clone(), "https://www.dumpert.nl", "");
    let without_www = filter(credentials, "https://dumpert.nl", "");

    assert_eq!(with_www.len(), 1);
    assert_eq!(without_www.len(), 1);
    assert_eq!(with_www[0].service_name.as_deref(), Some("Dumpert"));
    assert_eq!(without_www[0].service_name.as_deref(), Some("Dumpert"));
}

/// [#9] - Subdomain matching
#[test]
fn test_subdomain_matching() {
    let credentials = create_shared_test_credentials();

    let app_subdomain = filter(credentials.clone(), "https://app.example.com", "");
    let www_subdomain = filter(credentials.clone(), "https://www.example.com", "");
    let no_subdomain = filter(credentials, "https://example.com", "");

    assert_eq!(app_subdomain.len(), 1);
    assert_eq!(app_subdomain[0].service_name.as_deref(), Some("Subdomain Example"));
    assert_eq!(www_subdomain.len(), 1);
    assert_eq!(www_subdomain[0].service_name.as_deref(), Some("Subdomain Example"));
    assert_eq!(no_subdomain.len(), 1);
    assert_eq!(no_subdomain[0].service_name.as_deref(), Some("Subdomain Example"));
}

/// [#10] - Paths and query strings ignored
#[test]
fn test_paths_and_query_strings_ignored() {
    let credentials = create_shared_test_credentials();

    let with_path = filter(credentials.clone(), "https://github.com/user/repo", "");
    let with_query = filter(credentials.clone(), "https://stackoverflow.com/questions?tab=newest", "");
    let with_fragment = filter(credentials, "https://gmail.com#inbox", "");

    assert_eq!(with_path.len(), 1);
    assert_eq!(with_path[0].service_name.as_deref(), Some("GitHub"));
    assert_eq!(with_query.len(), 1);
    assert_eq!(with_query[0].service_name.as_deref(), Some("Stack Overflow"));
    assert_eq!(with_fragment.len(), 1);
    assert_eq!(with_fragment[0].service_name.as_deref(), Some("Gmail"));
}

/// [#11] - Complex URL variations
#[test]
fn test_complex_url_variations() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://www.coolblue.nl/product/12345?ref=google", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].service_name.as_deref(), Some("Coolblue"));
}

/// [#12] - Priority ordering
#[test]
fn test_priority_ordering() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "coolblue.nl", "");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].service_name.as_deref(), Some("Coolblue"));
}

/// [#13] - Title-only matching
#[test]
fn test_title_only_matching() {
    let credentials = create_shared_test_credentials();
    let matches = filter(credentials, "https://nomatch.com", "newyorktimes");

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].service_name.as_deref(), Some("Title Only newyorktimes"));
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
    assert_eq!(matches[0].service_name.as_deref(), Some("Coolblue App"));
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
    assert_eq!(matches[0].service_name.as_deref(), Some("Reddit"));
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
    assert_eq!(matches[0].service_name.as_deref(), Some("Marktplaats.nl"));
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
    assert_eq!(google_matches[0].service_name.as_deref(), Some("Google App"));

    // Test com.facebook package matches
    let facebook_matches = filter(credentials.clone(), "com.facebook.katana", "");
    assert_eq!(facebook_matches.len(), 1);
    assert_eq!(facebook_matches[0].service_name.as_deref(), Some("Facebook"));

    // Test that web domain doesn't match package name
    let web_matches = filter(credentials, "https://example.com", "");
    assert_eq!(web_matches.len(), 1);
    assert_eq!(web_matches[0].service_name.as_deref(), Some("Generic Site"));
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
    assert_eq!(blabla_matches[0].service_name.as_deref(), Some("BlaBla AU"));

    // Test that example.com.au doesn't match blabla.blabla.com.au
    let example_matches = filter(credentials.clone(), "https://example.com.au", "");
    assert_eq!(example_matches.len(), 1);
    assert_eq!(example_matches[0].service_name.as_deref(), Some("Example Site AU"));

    // Test that .co.uk domains work correctly too
    let uk_matches = filter(credentials, "https://example.co.uk", "");
    assert_eq!(uk_matches.len(), 1);
    assert_eq!(uk_matches[0].service_name.as_deref(), Some("UK Site"));
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
    };

    let json = serde_json::to_string(&input).unwrap();
    let output_json = filter_credentials_json(&json).unwrap();
    let output: CredentialMatcherOutput = serde_json::from_str(&output_json).unwrap();

    assert_eq!(output.matched_ids.len(), 1);
    // Look up the credential by ID to verify it's GitHub
    let matched = credentials.iter().find(|c| c.id == output.matched_ids[0]).unwrap();
    assert_eq!(matched.service_name.as_deref(), Some("GitHub"));
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
    println!("example.com matches: {:?}", example_matches.iter().map(|c| c.service_name.as_deref()).collect::<Vec<_>>());
    assert!(example_matches.len() >= 1, "example.com should match at least one credential");
    assert!(example_matches.iter().any(|c| c.service_name.as_deref() == Some("Example Site")),
        "example.com should match Example Site");
    assert!(!example_matches.iter().any(|c| c.service_name.as_deref() == Some("Another Site")),
        "example.com should NOT match Another Site");

    // Test 3: another-example.com should only match Another Site
    let another_matches = filter(credentials.clone(), "https://another-example.com/signin", "E2E Test Form");
    assert_eq!(another_matches.len(), 1, "another-example.com should match exactly one credential");
    assert_eq!(another_matches[0].service_name.as_deref(), Some("Another Site"));

    // Test 4: test.example.com subdomain should match Example Subdomain
    let subdomain_matches = filter(credentials, "https://test.example.com/auth", "E2E Test Form");
    assert!(subdomain_matches.len() >= 1, "test.example.com should match at least one credential");
    assert!(subdomain_matches.iter().any(|c| c.service_name.as_deref() == Some("Example Subdomain")),
        "test.example.com should match Example Subdomain");
    assert!(!subdomain_matches.iter().any(|c| c.service_name.as_deref() == Some("Another Site")),
        "test.example.com should NOT match Another Site");
}
