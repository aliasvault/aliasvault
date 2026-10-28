//! Credential filtering for autofill across all platforms.
//!
//! This implementation follows the unified filtering algorithm specification
//! for cross-platform consistency with browser extensions, iOS, and Android.
//!
//! Stages in execution order with early returns, each with the `matched_priority` it reports:
//! 1. App package name exact match, for mobile apps (priority 1)
//! 2. URL domain matching: exact, subdomain, root domain (priority 2)
//! 3. Root domain words against item names, web pages in Default mode only (priority 3)
//! 4. Page title words against item names, for input that is not a web page (priority 3)
//! 5. Search string words against item names (priority 4)
//!
//! Stages 3 to 5 only consider credentials without URLs.
//!
//! Anti-phishing: a name match never returns a credential that has a URL, and a URL (any input with a
//! scheme) whose host cannot be extracted matches nothing instead of falling through to the name stages.

pub(crate) mod domain;
mod public_suffix;
mod stop_words;

use serde::{Deserialize, Serialize};

pub use domain::{extract_domain, extract_domain_with_port, extract_root_domain, is_related_origin_allowed, is_rp_id_allowed_for_host, DomainWithPort};
use domain::{domains_match, is_app_package_name, split_url};
use stop_words::STOP_WORD_SET;

/// Default per-priority cap on returned matches when the caller does not supply `max_results`.
const DEFAULT_MAX_RESULTS: usize = 10;

/// How far a URL match may reach: subdomains and root domain words, subdomains only, or the exact domain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum AutofillMatchingMode {
    #[default]
    Default,
    UrlExact,
    UrlSubdomain,
}

/// An item as the matcher sees it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credential {
    pub id: String,
    pub item_name: Option<String>,
    #[serde(default)]
    pub item_urls: Vec<String>,
    #[serde(default)]
    pub username: Option<String>,
}

/// What to match against what.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialMatcherInput {
    pub credentials: Vec<Credential>,
    /// The current URL, app package name or search text.
    pub current_url: String,
    #[serde(default)]
    pub page_title: String,
    #[serde(default)]
    pub matching_mode: AutofillMatchingMode,
    /// Match domains regardless of port (Android has no port information).
    #[serde(default)]
    pub ignore_port: bool,
    /// Cap on returned matches, 10 when omitted.
    #[serde(default)]
    pub max_results: Option<usize>,
}

/// The matches of the best matching stage.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialMatcherOutput {
    pub matched_ids: Vec<String>,
    /// The priority of the stage that matched (1 to 4), or 0 for no match.
    pub matched_priority: u8,
}

impl CredentialMatcherOutput {
    /// A match at the given priority level.
    fn matched(matched_priority: u8, matched_ids: Vec<String>) -> Self {
        Self { matched_ids, matched_priority }
    }
}

/*
 * The stages run in order and the first one with a match wins: app package name (priority 1), URL domain (2), root
 * domain words or page title words against item names (3), the search text against item names (4).
 * Anti-phishing: the name stages only consider items without URLs, and a URL whose host cannot be extracted matches
 * nothing instead of falling through to them.
 */

/// The credentials of the best matching stage.
pub fn filter_credentials(input: CredentialMatcherInput) -> CredentialMatcherOutput {
    let CredentialMatcherInput { credentials, current_url, page_title, matching_mode, ignore_port, max_results } = input;
    let max_results = max_results.unwrap_or(DEFAULT_MAX_RESULTS);

    if current_url.is_empty() {
        return CredentialMatcherOutput::default();
    }

    if is_app_package_name(&current_url) {
        // Stage 1: app package name. A package name that matches nothing falls through to the text stages.
        let ids = match_package_name(&credentials, &current_url, max_results);
        if !ids.is_empty() {
            return CredentialMatcherOutput::matched(1, ids);
        }
    } else {
        let current = extract_domain_with_port(&current_url);
        if !current.domain.is_empty() {
            // Stage 2: URL domain.
            let allow_subdomain = matches!(matching_mode, AutofillMatchingMode::Default | AutofillMatchingMode::UrlSubdomain);
            let ids = match_domains(&credentials, &current, allow_subdomain, ignore_port, max_results);
            if !ids.is_empty() {
                return CredentialMatcherOutput::matched(2, ids);
            }

            // Stage 3: root domain words against item names, in Default mode only; the URL-only modes must not fall back to it.
            if matching_mode == AutofillMatchingMode::Default {
                let domain_words = extract_words(&extract_root_domain(&current.domain));
                let ids = match_item_names(&credentials, &domain_words, max_results);
                if !ids.is_empty() {
                    return CredentialMatcherOutput::matched(3, ids);
                }
            }

            // A web page never falls through to the text stages.
            return CredentialMatcherOutput::default();
        }

        // Input with a scheme is a URL whose host could not be extracted: it never falls through either.
        if split_url(&current_url.trim().to_lowercase()).0.is_some() {
            return CredentialMatcherOutput::default();
        }
    }

    // Stage 4: page title words against item names.
    let title_words = extract_words(&page_title);
    let ids = match_item_names(&credentials, &title_words, max_results);
    if !ids.is_empty() {
        return CredentialMatcherOutput::matched(3, ids);
    }

    // Stage 5: the search text against item names.
    let search_words = extract_words(&current_url);
    let ids = match_item_names(&credentials, &search_words, max_results);
    if !ids.is_empty() {
        return CredentialMatcherOutput::matched(4, ids);
    }

    CredentialMatcherOutput::default()
}

/// Ids of credentials whose URLs contain the package name as-is.
fn match_package_name(credentials: &[Credential], package_name: &str, max_results: usize) -> Vec<String> {
    credentials
        .iter()
        .filter(|cred| cred.item_urls.iter().any(|url| url.trim() == package_name))
        .map(|cred| cred.id.clone())
        .take(max_results)
        .collect()
}

/// Ids of the credentials at the best domain match rank (1 domain and port, 2 domain, 3 subdomain or root domain);
/// lower ranks are left out.
fn match_domains(credentials: &[Credential], current: &DomainWithPort, allow_subdomain: bool, ignore_port: bool, max_results: usize) -> Vec<String> {
    let ranked: Vec<(&str, u8)> = credentials
        .iter()
        .filter_map(|cred| domain_match_rank(cred, current, allow_subdomain, ignore_port).map(|rank| (cred.id.as_str(), rank)))
        .collect();

    let Some(best) = ranked.iter().map(|(_, rank)| *rank).min() else { return vec![] };

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

        // Rank 1 needs the same domain and port (or both none); with ignore_port the plain domain match is the best there is.
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

/// Ids of credentials without URLs whose item name shares a complete word with `words`; a credential with a URL never
/// matches by name (anti-phishing).
fn match_item_names(credentials: &[Credential], words: &[String], max_results: usize) -> Vec<String> {
    if words.is_empty() {
        return vec![];
    }

    credentials
        .iter()
        .filter(|cred| cred.item_urls.iter().all(|url| url.trim().is_empty()))
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

/// Words of this many characters or fewer are too generic to match on.
const MAX_IGNORED_WORD_CHARS: usize = 3;

/// The lowercase words of a text, without punctuation, short words and stop words.
fn extract_words(text: &str) -> Vec<String> {
    if text.is_empty() {
        return vec![];
    }

    text.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .filter(|word| word.chars().count() > MAX_IGNORED_WORD_CHARS && !STOP_WORD_SET.contains(*word))
        .map(String::from)
        .collect()
}

/// [`filter_credentials`] over JSON, for the uniffi bindings.
pub fn filter_credentials_json(input_json: &str) -> crate::common::error::VaultResult<String> {
    crate::common::error::json_call(input_json, |input| Ok(filter_credentials(input)))
}

#[cfg(test)]
mod tests;
