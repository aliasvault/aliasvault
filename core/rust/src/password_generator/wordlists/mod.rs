//! Embedded Diceware wordlists.
//!
//! Each list contains exactly 7776 words (6^5), one word per line, in dice order.
//! The lists are embedded into the binary via `include_str!` and parsed lazily
//! (once per language) into a `Vec<&'static str>`.

use std::sync::OnceLock;

use super::Language;

static EN_RAW: &str = include_str!("en.diceware");
static NL_RAW: &str = include_str!("nl.diceware");
static DE_RAW: &str = include_str!("de.diceware");
static FR_RAW: &str = include_str!("fr.diceware");
static ES_RAW: &str = include_str!("es.diceware");
static IT_RAW: &str = include_str!("it.diceware");

/// Parsed wordlists, memoized per language so we only split each list once.
static PARSED: [OnceLock<Vec<&'static str>>; 6] = [
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
];

/// Map a language to its embedded raw text and stable index.
fn raw_for(language: Language) -> (usize, &'static str) {
    match language {
        Language::English => (0, EN_RAW),
        Language::Dutch => (1, NL_RAW),
        Language::German => (2, DE_RAW),
        Language::French => (3, FR_RAW),
        Language::Spanish => (4, ES_RAW),
        Language::Italian => (5, IT_RAW),
    }
}

/// Get the wordlist for the given language as a slice of words.
///
/// The returned slice is memoized, so repeated calls for the same language are cheap.
pub fn list(language: Language) -> &'static [&'static str] {
    let (index, raw) = raw_for(language);
    PARSED[index].get_or_init(|| {
        raw.lines()
            .map(|line| line.trim_end_matches('\r'))
            .filter(|line| !line.is_empty())
            .collect()
    })
}
