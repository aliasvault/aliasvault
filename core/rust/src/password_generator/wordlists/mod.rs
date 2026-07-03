//! Embedded Diceware wordlists.
//!
//! Each list contains exactly 7776 words (6^5), one word per line, in dice order.
//! The lists are embedded into the binary via `include_str!`.
//!
//! Languages are keyed by a free-text code (case-insensitive). Adding a new language is a
//! Rust-only change: drop the `<code>.diceware` file in this directory and add one entry to
//! the `WORDLISTS` registry below — no changes are needed in the TypeScript model or the
//! apps. Unknown codes fall back to English.

/// The registry of bundled wordlists, as `(code, raw text)`. The code is the normalized two-letter
/// ISO 639-1 language code; the first entry is the default/fallback (English). To add a language,
/// add one line here plus the matching `.diceware` file.
static WORDLISTS: &[(&str, &str)] = &[
    ("en", include_str!("en.diceware")),
    ("nl", include_str!("nl.diceware")),
    ("de", include_str!("de.diceware")),
    ("fr", include_str!("fr.diceware")),
    ("es", include_str!("es.diceware")),
    ("it", include_str!("it.diceware")),
    ("ro", include_str!("ro.diceware")),
];

/// Resolve a language code (case-insensitive) to its raw wordlist text, falling back to
/// English (the first registry entry) for any unknown or empty code.
fn resolve_raw(code: &str) -> &'static str {
    WORDLISTS
        .iter()
        .find(|(c, _)| c.eq_ignore_ascii_case(code))
        .map(|(_, raw)| *raw)
        .unwrap_or(WORDLISTS[0].1)
}

/// Get the wordlist for the given language code as a vector of words.
///
/// Unknown codes fall back to the English list. Parsing is cheap (~7776 line splits) and
/// happens once per generation call.
pub fn list(code: &str) -> Vec<&'static str> {
    resolve_raw(code)
        .lines()
        .map(|line| line.trim_end_matches('\r'))
        .filter(|line| !line.is_empty())
        .collect()
}

/// List the codes of all bundled languages (first is the default, English).
/// Used to build a language picker in the UI without hard-coding the set there.
pub fn available_codes() -> Vec<&'static str> {
    WORDLISTS.iter().map(|(code, _)| *code).collect()
}
