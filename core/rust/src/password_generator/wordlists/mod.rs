//! The embedded Diceware wordlists: 7776 words each, one per line in dice order, keyed by language code.

/// The bundled wordlists as `(ISO 639-1 code, raw text)`; the first entry is the fallback (English).
static WORDLISTS: &[(&str, &str)] = &[
    ("en", include_str!("en.diceware")),
    ("nl", include_str!("nl.diceware")),
    ("de", include_str!("de.diceware")),
    ("fr", include_str!("fr.diceware")),
    ("es", include_str!("es.diceware")),
    ("it", include_str!("it.diceware")),
    ("ro", include_str!("ro.diceware")),
];

/// The words of a language (case-insensitive code); an unknown or empty code gives the English list.
pub fn list(code: &str) -> Vec<&'static str> {
    let raw = WORDLISTS.iter().find(|(c, _)| c.eq_ignore_ascii_case(code)).map(|(_, raw)| *raw).unwrap_or(WORDLISTS[0].1);
    raw.lines().map(|line| line.trim_end_matches('\r')).filter(|line| !line.is_empty()).collect()
}

/// The codes of the bundled languages, the default (English) first.
pub fn available_codes() -> Vec<&'static str> {
    WORDLISTS.iter().map(|(code, _)| *code).collect()
}
