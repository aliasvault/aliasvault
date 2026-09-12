//! Credential filtering for autofill across all platforms.
//!
//! This implementation follows the unified filtering algorithm specification
//! for cross-platform consistency with browser extensions, iOS, and Android.
//!
//! Algorithm structure (priority order with early returns):
//! 1. Priority 1: app package name exact match (for mobile apps)
//! 2. Priority 2: URL domain matching (exact, subdomain, root domain)
//! 3. Priority 3b: root domain word matching against item names (only credentials without URLs)
//! 4. Priority 3: page title fallback (only credentials without URLs, anti-phishing)
//! 5. Priority 4: text matching of the search string against item names

pub(crate) mod domain;
mod stop_words;

use serde::{Deserialize, Serialize};

pub use domain::{extract_domain, extract_domain_with_port, extract_root_domain, DomainWithPort};
use domain::{domains_match, is_app_package_name};
use stop_words::STOP_WORD_SET;

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
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CredentialMatcherOutput {
    /// IDs of matched credentials, in priority order. Capped at
    /// `input.max_results` (defaults to [`DEFAULT_MAX_RESULTS`]).
    pub matched_ids: Vec<String>,
    /// Which priority level matched (1-4, or 0 if no match)
    pub matched_priority: u8,
}

impl CredentialMatcherOutput {
    /// A match at the given priority level.
    fn matched(matched_priority: u8, matched_ids: Vec<String>) -> Self {
        Self { matched_ids, matched_priority }
    }
}

/// Filter credentials based on current URL and page context with anti-phishing protection.
///
/// Returns the credentials of the best matching priority stage, capped per `input.max_results`
/// (defaulting to [`DEFAULT_MAX_RESULTS`]).
pub fn filter_credentials(input: CredentialMatcherInput) -> CredentialMatcherOutput {
    let CredentialMatcherInput { credentials, current_url, page_title, matching_mode, ignore_port, max_results } = input;
    let max_results = max_results.unwrap_or(DEFAULT_MAX_RESULTS);

    if current_url.is_empty() {
        return CredentialMatcherOutput::default();
    }

    if is_app_package_name(&current_url) {
        // Priority 1: app package name exact match (e.g. com.coolblue.app).
        let ids = match_package_name(&credentials, &current_url, max_results);
        if !ids.is_empty() {
            return CredentialMatcherOutput::matched(1, ids);
        }
        // A package name that matched nothing skips URL matching and falls through to the text stages.
    } else {
        let current = extract_domain_with_port(&current_url);
        if !current.domain.is_empty() {
            // Priority 2: URL domain matching (exact domain+port, exact domain, then subdomain/root domain).
            let allow_subdomain = matches!(matching_mode, AutofillMatchingMode::Default | AutofillMatchingMode::UrlSubdomain);
            let ids = match_domains(&credentials, &current, allow_subdomain, ignore_port, max_results);
            if !ids.is_empty() {
                return CredentialMatcherOutput::matched(2, ids);
            }

            // Priority 3b: words from ONLY the root domain (no subdomains, no path/query) against item
            // names, e.g. outlook.office.com contributes "office" but not "outlook". Same anti-phishing
            // rule as Priority 3: only credentials with no URLs are eligible. This wildcard is what the
            // Default mode adds on top of URL matching, so the URL-only modes must not fall back to it.
            if matching_mode == AutofillMatchingMode::Default {
                let domain_words = extract_words(&extract_root_domain(&current.domain));
                let ids = match_item_names(&credentials, &domain_words, true, max_results);
                if !ids.is_empty() {
                    return CredentialMatcherOutput::matched(3, ids);
                }
            }

            // A web page never falls through to the text stages.
            return CredentialMatcherOutput::default();
        }
    }

    // Priority 3: page title against item names when domain extraction failed (desktop apps, malformed
    // URLs). Anti-phishing: only credentials with NO URLs are eligible.
    let title_words = extract_words(&page_title);
    let ids = match_item_names(&credentials, &title_words, true, max_results);
    if !ids.is_empty() {
        return CredentialMatcherOutput::matched(3, ids);
    }

    // Priority 4: the search string itself against item names.
    let search_words = extract_words(&current_url);
    let ids = match_item_names(&credentials, &search_words, false, max_results);
    if !ids.is_empty() {
        return CredentialMatcherOutput::matched(4, ids);
    }

    CredentialMatcherOutput::default()
}

/// Ids of credentials whose URLs contain the package name verbatim.
fn match_package_name(credentials: &[Credential], package_name: &str, max_results: usize) -> Vec<String> {
    credentials
        .iter()
        .filter(|cred| cred.item_urls.iter().any(|url| url == package_name))
        .map(|cred| cred.id.clone())
        .take(max_results)
        .collect()
}

/// Ids of the credentials at the best domain match rank; only that rank is returned.
///
/// Ranks: 1 exact domain+port, 2 exact domain ignoring port, 3 subdomain/root domain. If any credential
/// matches on domain+port, credentials on the same domain with another port are left out.
fn match_domains(credentials: &[Credential], current: &DomainWithPort, allow_subdomain: bool, ignore_port: bool, max_results: usize) -> Vec<String> {
    let ranked: Vec<(&str, u8)> = credentials
        .iter()
        .filter_map(|cred| domain_match_rank(cred, current, allow_subdomain, ignore_port).map(|rank| (cred.id.as_str(), rank)))
        .collect();

    let Some(best) = ranked.iter().map(|(_, rank)| *rank).min() else {
        return vec![];
    };

    ranked.into_iter().filter(|(_, rank)| *rank == best).map(|(id, _)| id.to_string()).take(max_results).collect()
}

/// The best domain match rank across a credential's URLs, or `None` when none match.
fn domain_match_rank(cred: &Credential, current: &DomainWithPort, allow_subdomain: bool, ignore_port: bool) -> Option<u8> {
    let mut best: Option<u8> = None;

    for item_url in &cred.item_urls {
        let item = extract_domain_with_port(item_url);
        if item.domain.is_empty() {
            continue;
        }

        // Rank 1 needs the same domain AND the same port (or both no port). Android does not provide
        // port information, so with ignore_port the plain domain match is the best available.
        if !ignore_port && current.domain == item.domain && current.port == item.port {
            return Some(1);
        }

        if current.domain == item.domain && best != Some(2) {
            best = Some(2);
            if ignore_port {
                return best;
            }
        }

        if allow_subdomain && best.is_none() && domains_match(&current.domain, &item.domain) {
            best = Some(3);
        }
    }

    best
}

/// Ids of credentials whose item name shares a complete word with `words`.
///
/// With `require_no_urls`, credentials that have any URL are skipped: a name match must never
/// surface a credential bound to another site (anti-phishing).
fn match_item_names(credentials: &[Credential], words: &[String], require_no_urls: bool, max_results: usize) -> Vec<String> {
    if words.is_empty() {
        return vec![];
    }

    credentials
        .iter()
        .filter(|cred| !require_no_urls || !cred.item_urls.iter().any(|url| !url.is_empty()))
        .filter(|cred| {
            cred.item_name.as_deref().is_some_and(|name| {
                let name_words = extract_words(name);
                words.iter().any(|word| name_words.contains(word))
            })
        })
        .map(|cred| cred.id.clone())
        .take(max_results)
        .collect()
}

/// Extract meaningful words from text, removing punctuation and filtering stop words.
fn extract_words(text: &str) -> Vec<String> {
    if text.is_empty() {
        return vec![];
    }

    text.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .filter(|word| word.len() > 3 && !STOP_WORD_SET.contains(*word))
        .map(String::from)
        .collect()
}

/// JSON sibling of [`filter_credentials`]. Input: `CredentialMatcherInput`. Output: `CredentialMatcherOutput`.
pub fn filter_credentials_json(input_json: &str) -> crate::error::VaultResult<String> {
    crate::error::json_call(input_json, |input| Ok(filter_credentials(input)))
}

#[cfg(test)]
mod tests;
