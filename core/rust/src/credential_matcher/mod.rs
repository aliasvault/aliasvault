//! Credential filtering for autofill across all platforms.
//!
//! This implementation follows the unified filtering algorithm specification
//! for cross-platform consistency with browser extensions, iOS, and Android.
//!
//! Algorithm Structure (Priority Order with Early Returns):
//! 1. PRIORITY 1: App Package Name Exact Match (for mobile apps)
//! 2. PRIORITY 2: URL Domain Matching (exact, subdomain, root domain)
//! 3. PRIORITY 3: Service Name Fallback (only for credentials without URLs - anti-phishing)
//! 4. PRIORITY 4: Text/Page Title Matching (non-URL search)

mod domain;
mod stop_words;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub use domain::{extract_domain, extract_root_domain};
use domain::{domains_match, is_app_package_name};
use stop_words::STOP_WORDS;

/// Matching mode for credential filtering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AutofillMatchingMode {
    #[default]
    Default,
    UrlExact,
    UrlSubdomain,
}

/// A credential record for matching.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Credential {
    pub id: String,
    pub service_name: Option<String>,
    pub service_url: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
}

/// Input for credential filtering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialMatcherInput {
    /// List of credentials to filter
    pub credentials: Vec<Credential>,
    /// Current URL or app package name
    pub current_url: String,
    /// Current page title (optional)
    #[serde(default)]
    pub page_title: String,
    /// Matching mode
    #[serde(default)]
    pub matching_mode: AutofillMatchingMode,
}

/// Output from credential filtering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialMatcherOutput {
    /// IDs of matched credentials (max 3), in priority order
    pub matched_ids: Vec<String>,
    /// Which priority level matched (1-4, or 0 if no match)
    pub matched_priority: u8,
}

/// Internal credential with priority for sorting.
#[derive(Debug, Clone)]
struct CredentialWithPriority {
    credential: Credential,
    priority: u8,
}

/// Filter credentials based on current URL and page context with anti-phishing protection.
///
/// # Arguments
/// * `input` - CredentialMatcherInput containing credentials and search context
///
/// # Returns
/// CredentialMatcherOutput with filtered credentials (max 3)
pub fn filter_credentials(input: CredentialMatcherInput) -> CredentialMatcherOutput {
    let CredentialMatcherInput {
        credentials,
        current_url,
        page_title,
        matching_mode,
    } = input;

    // Early return for empty URL
    if current_url.is_empty() {
        return CredentialMatcherOutput {
            matched_ids: vec![],
            matched_priority: 0,
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PRIORITY 1: App Package Name Exact Match
    // Check if current URL is an app package name (e.g., com.coolblue.app)
    // ═══════════════════════════════════════════════════════════════════════════════
    let is_package_name = is_app_package_name(&current_url);
    if is_package_name {
        let package_match_ids: Vec<String> = credentials
            .iter()
            .filter(|cred| {
                cred.service_url
                    .as_ref()
                    .map(|url| !url.is_empty() && url == &current_url)
                    .unwrap_or(false)
            })
            .map(|cred| cred.id.clone())
            .take(3)
            .collect();

        // EARLY RETURN if matches found
        if !package_match_ids.is_empty() {
            return CredentialMatcherOutput {
                matched_ids: package_match_ids,
                matched_priority: 1,
            };
        }
        // If no matches found, skip URL matching and go directly to text matching (Priority 4)
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PRIORITY 2: URL Domain Matching
    // Try to extract domain from current URL (skip if package name)
    // ═══════════════════════════════════════════════════════════════════════════════
    if !is_package_name {
        let current_domain = extract_domain(&current_url);

        if !current_domain.is_empty() {
            let mut filtered: Vec<CredentialWithPriority> = Vec::new();

            // Determine matching features based on mode
            let enable_exact_match = true; // Always enabled
            let enable_subdomain_match = matches!(
                matching_mode,
                AutofillMatchingMode::Default | AutofillMatchingMode::UrlSubdomain
            );

            // Process credentials with service URLs
            for cred in &credentials {
                let service_url = match &cred.service_url {
                    Some(url) if !url.is_empty() => url,
                    _ => continue, // Handle these in Priority 3
                };

                let cred_domain = extract_domain(service_url);
                if cred_domain.is_empty() {
                    continue;
                }

                // Check for exact match (priority 1)
                if enable_exact_match && current_domain == cred_domain {
                    filtered.push(CredentialWithPriority {
                        credential: cred.clone(),
                        priority: 1,
                    });
                    continue;
                }

                // Check for subdomain/partial match (priority 2)
                if enable_subdomain_match && domains_match(&current_domain, &cred_domain) {
                    filtered.push(CredentialWithPriority {
                        credential: cred.clone(),
                        priority: 2,
                    });
                }
            }

            // EARLY RETURN if matches found
            if !filtered.is_empty() {
                // Sort by priority, deduplicate by ID, take first 3
                filtered.sort_by_key(|c| c.priority);
                let mut seen_ids: HashSet<String> = HashSet::new();
                let unique_ids: Vec<String> = filtered
                    .into_iter()
                    .filter(|c| seen_ids.insert(c.credential.id.clone()))
                    .map(|c| c.credential.id)
                    .take(3)
                    .collect();

                return CredentialMatcherOutput {
                    matched_ids: unique_ids,
                    matched_priority: 2,
                };
            }

            // ═══════════════════════════════════════════════════════════════════════════
            // PRIORITY 3: Page Title / Service Name Fallback (Anti-Phishing Protection)
            // No domain matches found - search in service names using page title
            // CRITICAL: Only search credentials with NO service URL defined
            // ═══════════════════════════════════════════════════════════════════════════
            if !page_title.is_empty() {
                let title_words = extract_words(&page_title);

                if !title_words.is_empty() {
                    let name_match_ids: Vec<String> = credentials
                        .iter()
                        .filter(|cred| {
                            // SECURITY: Skip credentials that have a URL defined
                            if cred.service_url.as_ref().map(|u| !u.is_empty()).unwrap_or(false) {
                                return false;
                            }

                            // Check page title match with service name
                            if let Some(service_name) = &cred.service_name {
                                let cred_name_words = extract_words(service_name);

                                // Match only complete words, not substrings
                                title_words.iter().any(|title_word| {
                                    cred_name_words.iter().any(|cred_word| title_word == cred_word)
                                })
                            } else {
                                false
                            }
                        })
                        .map(|cred| cred.id.clone())
                        .take(3)
                        .collect();

                    // Return matches from Priority 3 if any found
                    if !name_match_ids.is_empty() {
                        return CredentialMatcherOutput {
                            matched_ids: name_match_ids,
                            matched_priority: 3,
                        };
                    }
                }
            }

            // No matches found in Priority 2 or Priority 3
            return CredentialMatcherOutput {
                matched_ids: vec![],
                matched_priority: 0,
            };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PRIORITY 4: Text Matching
    // Used when: 1) Package name didn't match in Priority 1, OR 2) URL extraction failed
    // Performs word-based matching on service names
    // ═══════════════════════════════════════════════════════════════════════════════
    let search_words = extract_words(&current_url);

    if !search_words.is_empty() {
        let text_match_ids: Vec<String> = credentials
            .iter()
            .filter(|cred| {
                if let Some(service_name) = &cred.service_name {
                    let service_name_words = extract_words(service_name);

                    // Check if any search word matches any service name word exactly
                    search_words
                        .iter()
                        .any(|search_word| service_name_words.contains(search_word))
                } else {
                    false
                }
            })
            .map(|cred| cred.id.clone())
            .take(3)
            .collect();

        if !text_match_ids.is_empty() {
            return CredentialMatcherOutput {
                matched_ids: text_match_ids,
                matched_priority: 4,
            };
        }
    }

    // No matches found
    CredentialMatcherOutput {
        matched_ids: vec![],
        matched_priority: 0,
    }
}

/// Extract meaningful words from text, removing punctuation and filtering stop words.
fn extract_words(text: &str) -> Vec<String> {
    if text.is_empty() {
        return vec![];
    }

    let stop_words: HashSet<&str> = STOP_WORDS.iter().copied().collect();

    text.to_lowercase()
        // Replace common separators and punctuation with spaces (including dots)
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .filter(|word| word.len() > 3 && !stop_words.contains(*word))
        .map(String::from)
        .collect()
}

/// Filter credentials from JSON input (convenience function for FFI).
pub fn filter_credentials_json(input_json: &str) -> Result<String, String> {
    let input: CredentialMatcherInput =
        serde_json::from_str(input_json).map_err(|e| e.to_string())?;
    let output = filter_credentials(input);
    serde_json::to_string(&output).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
