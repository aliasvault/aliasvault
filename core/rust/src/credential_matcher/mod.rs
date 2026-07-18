//! Credential filtering for autofill across all platforms.
//!
//! This implementation follows the unified filtering algorithm specification
//! for cross-platform consistency with browser extensions, iOS, and Android.
//!
//! Algorithm Structure (Priority Order with Early Returns):
//! 1. PRIORITY 1: App Package Name Exact Match (for mobile apps)
//! 2. PRIORITY 2: URL Domain Matching (exact, subdomain, root domain)
//! 3. PRIORITY 3: Page Title Fallback (only for credentials without URLs - anti-phishing)
//! 3b. PRIORITY 3b: Root Domain Word Matching (only base domain, no subdomains or paths)
//! 4. PRIORITY 4: Text/Page Title Matching (non-URL search)

mod domain;
mod stop_words;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub use domain::{extract_domain, extract_domain_with_port, extract_root_domain, DomainWithPort};
use domain::{domains_match, is_app_package_name};
use stop_words::STOP_WORDS;

/// Default per-priority cap on returned matches when the caller does not
/// supply `max_results`. Chosen as a balance between dropdown usability
/// (scrollable but not overwhelming) and inline-strip needs.
pub const DEFAULT_MAX_RESULTS: usize = 10;

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
    pub item_name: Option<String>,
    /// List of URLs associated with this item (supports multi-value URL fields)
    #[serde(default)]
    pub item_urls: Vec<String>,
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
    /// When true, skip port matching entirely (useful for Android where port info is unavailable).
    /// All domain matches will be treated equally regardless of port.
    #[serde(default)]
    pub ignore_port: bool,
    /// Per-priority cap on returned matches. Defaults to [`DEFAULT_MAX_RESULTS`]
    /// (10) when omitted by the caller.
    #[serde(default)]
    pub max_results: Option<usize>,
}

/// Output from credential filtering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialMatcherOutput {
    /// IDs of matched credentials, in priority order. Capped at
    /// `input.max_results` (defaults to [`DEFAULT_MAX_RESULTS`]).
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
/// CredentialMatcherOutput with filtered credentials (capped per
/// `input.max_results`, defaulting to [`DEFAULT_MAX_RESULTS`])
pub fn filter_credentials(input: CredentialMatcherInput) -> CredentialMatcherOutput {
    let CredentialMatcherInput {
        credentials,
        current_url,
        page_title,
        matching_mode,
        ignore_port,
        max_results,
    } = input;
    let max_results = max_results.unwrap_or(DEFAULT_MAX_RESULTS);

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
                cred.item_urls
                    .iter()
                    .any(|url| !url.is_empty() && url == &current_url)
            })
            .map(|cred| cred.id.clone())
            .take(max_results)
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
    // PRIORITY 2: URL Domain Matching (with port-aware priority)
    // Try to extract domain from current URL (skip if package name)
    //
    // Sub-priorities within URL matching:
    //   Priority 1: Exact domain+port match (e.g., example.com:8080 == example.com:8080)
    //   Priority 2: Exact domain match (ignoring port) (e.g., example.com:8080 == example.com)
    //   Priority 3: Subdomain/root domain match (e.g., sub.example.com matches example.com)
    // ═══════════════════════════════════════════════════════════════════════════════
    if !is_package_name {
        let current_domain_info = extract_domain_with_port(&current_url);

        if !current_domain_info.domain.is_empty() {
            let mut filtered: Vec<CredentialWithPriority> = Vec::new();

            // Determine matching features based on mode
            let enable_exact_match = true; // Always enabled
            let enable_subdomain_match = matches!(
                matching_mode,
                AutofillMatchingMode::Default | AutofillMatchingMode::UrlSubdomain
            );

            // Process credentials with item URLs (check all URLs for each credential)
            for cred in &credentials {
                // Skip credentials with no URLs - handle these in Priority 3
                if cred.item_urls.is_empty() {
                    continue;
                }

                // Track best match priority for this credential across all its URLs
                let mut best_priority: Option<u8> = None;

                for item_url in &cred.item_urls {
                    if item_url.is_empty() {
                        continue;
                    }

                    let cred_domain_info = extract_domain_with_port(item_url);
                    if cred_domain_info.domain.is_empty() {
                        continue;
                    }

                    // Check for exact domain+port match (priority 1 - highest)
                    // Both must have same domain AND same port (or both no port)
                    // Skip this check if ignore_port is true (e.g., Android doesn't provide port info)
                    if !ignore_port
                        && enable_exact_match
                        && current_domain_info.domain == cred_domain_info.domain
                        && current_domain_info.port == cred_domain_info.port
                    {
                        best_priority = Some(1);
                        break; // Can't do better than exact domain+port match
                    }

                    // Check for exact domain match, ignoring port (priority 2)
                    // When ignore_port is true, this becomes the highest priority for exact domain matches
                    if enable_exact_match
                        && current_domain_info.domain == cred_domain_info.domain
                        && best_priority.map_or(true, |p| p > 2)
                    {
                        best_priority = Some(2);
                        // Don't break - might find exact domain+port match in another URL (unless ignore_port)
                        if ignore_port {
                            break; // When ignoring port, domain match is the best we can do
                        }
                    }

                    // Check for subdomain/root domain match (priority 3)
                    if enable_subdomain_match
                        && domains_match(&current_domain_info.domain, &cred_domain_info.domain)
                        && best_priority.is_none()
                    {
                        best_priority = Some(3);
                        // Don't break - might find better match in another URL
                    }
                }

                if let Some(priority) = best_priority {
                    filtered.push(CredentialWithPriority {
                        credential: cred.clone(),
                        priority,
                    });
                }
            }

            // EARLY RETURN if matches found
            if !filtered.is_empty() {
                // Find the best (lowest) priority level we have
                let best_priority = filtered.iter().map(|c| c.priority).min().unwrap_or(3);

                // Only return credentials at the best priority level
                // This ensures that:
                // - If we have exact domain+port matches (1), we only show those
                // - If we have exact domain matches (2) but no port matches, we only show those
                // - If we only have subdomain matches (3), we show those
                let filtered_by_priority: Vec<CredentialWithPriority> = filtered
                    .into_iter()
                    .filter(|c| c.priority == best_priority)
                    .collect();

                // Sort by priority, deduplicate by ID, cap at max_results
                let mut sorted = filtered_by_priority;
                sorted.sort_by_key(|c| c.priority);
                let mut seen_ids: HashSet<String> = HashSet::new();
                let unique_ids: Vec<String> = sorted
                    .into_iter()
                    .filter(|c| seen_ids.insert(c.credential.id.clone()))
                    .map(|c| c.credential.id)
                    .take(max_results)
                    .collect();

                return CredentialMatcherOutput {
                    matched_ids: unique_ids,
                    matched_priority: 2,
                };
            }

            // ═══════════════════════════════════════════════════════════════════════════
            // PRIORITY 3b: Root Domain Word / Item Name Fallback
            // No domain or page title matches found - try matching words extracted
            // from ONLY the root domain (no subdomains, no path/query) against item names.
            // Same anti-phishing rule: only credentials with NO URLs are eligible.
            // IMPORTANT: Extract words only from root domain to avoid false positives:
            //   - outlook.office.com > extract from "office.com" only (not "outlook")
            //   - www.dumpert.nl > extract from "dumpert.nl" only (not "www")
            //   - Don't match "mail" from "/mail/" path
            // ═══════════════════════════════════════════════════════════════════════════
            let root_domain = extract_root_domain(&current_domain_info.domain);
            let domain_words = extract_words(&root_domain);

            if !domain_words.is_empty() {
                let domain_word_match_ids: Vec<String> = credentials
                    .iter()
                    .filter(|cred| {
                        // SECURITY: Skip credentials that have URLs defined
                        if !cred.item_urls.is_empty()
                            && cred.item_urls.iter().any(|u| !u.is_empty())
                        {
                            return false;
                        }

                        if let Some(item_name) = &cred.item_name {
                            let cred_name_words = extract_words(item_name);

                            // Match only complete words, not substrings
                            domain_words.iter().any(|domain_word| {
                                cred_name_words.iter().any(|cred_word| domain_word == cred_word)
                            })
                        } else {
                            false
                        }
                    })
                    .map(|cred| cred.id.clone())
                    .take(max_results)
                    .collect();

                if !domain_word_match_ids.is_empty() {
                    return CredentialMatcherOutput {
                        matched_ids: domain_word_match_ids,
                        matched_priority: 3,
                    };
                }
            }

            // No matches found in Priority 2, 3, or 3b
            return CredentialMatcherOutput {
                matched_ids: vec![],
                matched_priority: 0,
            };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // PRIORITY 3: Page Title / Item Name Fallback (Anti-Phishing Protection)
    // Only runs when domain extraction FAILED (desktop apps, malformed URLs, etc.)
    // CRITICAL: Only search credentials with NO URLs defined
    // NOTE: This does NOT run for normal web pages (those are handled in Priority 2)
    // ═══════════════════════════════════════════════════════════════════════════════
    if !page_title.is_empty() {
        let title_words = extract_words(&page_title);

        if !title_words.is_empty() {
            let name_match_ids: Vec<String> = credentials
                .iter()
                .filter(|cred| {
                    // SECURITY: Skip credentials that have URLs defined
                    if !cred.item_urls.is_empty()
                        && cred.item_urls.iter().any(|u| !u.is_empty())
                    {
                        return false;
                    }

                    // Check page title match with item name
                    if let Some(item_name) = &cred.item_name {
                        let cred_name_words = extract_words(item_name);

                        // Match only complete words, not substrings
                        title_words.iter().any(|title_word| {
                            cred_name_words.iter().any(|cred_word| title_word == cred_word)
                        })
                    } else {
                        false
                    }
                })
                .map(|cred| cred.id.clone())
                .take(max_results)
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

    // ═══════════════════════════════════════════════════════════════════════════════
    // PRIORITY 4: Text Matching
    // Used when: 1) Package name didn't match in Priority 1, OR 2) URL extraction failed
    // Performs word-based matching on item names
    // ═══════════════════════════════════════════════════════════════════════════════
    let search_words = extract_words(&current_url);

    if !search_words.is_empty() {
        let text_match_ids: Vec<String> = credentials
            .iter()
            .filter(|cred| {
                if let Some(item_name) = &cred.item_name {
                    let item_name_words = extract_words(item_name);

                    // Check if any search word matches any item name word exactly
                    search_words
                        .iter()
                        .any(|search_word| item_name_words.contains(search_word))
                } else {
                    false
                }
            })
            .map(|cred| cred.id.clone())
            .take(max_results)
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
