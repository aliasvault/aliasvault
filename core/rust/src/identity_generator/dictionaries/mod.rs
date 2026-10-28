//! Embedded name dictionaries for the identity generator.
//!
//! Each `.txt` file contains one name per line and is embedded into the binary via
//! `include_str!`. Languages are keyed by a two-letter ISO 639-1 code (case-insensitive).
//!
//! Adding or updating a language is a Rust-only change: drop the `.txt` files in a
//! `<code>/` subdirectory and register the language below. Unknown codes fall back
//! to English.
//!
//! Two dictionary layouts are supported:
//! - Flat: `firstnames_male.txt`, `firstnames_female.txt`, `lastnames.txt`.
//! - Decade-based: first names are split per birth decade
//!   (e.g. `firstnames_male_1980_1989.txt`), so generated first names match names
//!   that were popular around the generated birth year. Used by de, it and ro.

/// First names popular for births in `start_year..=end_year`.
pub(crate) struct DecadeNames {
    pub start_year: i32,
    pub end_year: i32,
    raw: &'static str,
}

impl DecadeNames {
    /// The names in this decade list.
    pub fn names(&self) -> impl Iterator<Item = &'static str> {
        parse_names(self.raw)
    }
}

/// The name lists of one language.
pub(crate) struct LanguageDictionary {
    /// The ISO 639-1 language code.
    pub code: &'static str,
    firstnames_male: &'static str,
    firstnames_female: &'static str,
    lastnames: &'static str,
    /// Empty for a language with flat lists.
    pub firstnames_male_by_decade: &'static [DecadeNames],
    /// Empty for a language with flat lists.
    pub firstnames_female_by_decade: &'static [DecadeNames],
}

impl LanguageDictionary {
    /// Flat male first names; empty for a decade-based language.
    pub fn firstnames_male(&self) -> Vec<&'static str> {
        parse_names(self.firstnames_male).collect()
    }

    /// Flat female first names; empty for a decade-based language.
    pub fn firstnames_female(&self) -> Vec<&'static str> {
        parse_names(self.firstnames_female).collect()
    }

    /// Last names.
    pub fn lastnames(&self) -> Vec<&'static str> {
        parse_names(self.lastnames).collect()
    }
}

/// A language with flat first name lists.
macro_rules! flat_language {
    ($code:literal) => {
        LanguageDictionary {
            code: $code,
            firstnames_male: include_str!(concat!($code, "/firstnames_male.txt")),
            firstnames_female: include_str!(concat!($code, "/firstnames_female.txt")),
            lastnames: include_str!(concat!($code, "/lastnames.txt")),
            firstnames_male_by_decade: &[],
            firstnames_female_by_decade: &[],
        }
    };
}

/// One decade list of a decade-based language.
macro_rules! decade {
    ($code:literal, $gender:literal, $start:literal, $end:literal) => {
        DecadeNames { start_year: $start, end_year: $end, raw: include_str!(concat!($code, "/firstnames_", $gender, "_", $start, "_", $end, ".txt")) }
    };
}

/// A language with first name lists per birth decade.
macro_rules! decade_language {
    ($code:literal, $(($start:literal, $end:literal)),+ $(,)?) => {
        LanguageDictionary {
            code: $code,
            firstnames_male: "",
            firstnames_female: "",
            lastnames: include_str!(concat!($code, "/lastnames.txt")),
            firstnames_male_by_decade: &[$(decade!($code, "male", $start, $end)),+],
            firstnames_female_by_decade: &[$(decade!($code, "female", $start, $end)),+],
        }
    };
}

/// The bundled languages, in the order the language list reports them.
pub(crate) static DICTIONARIES: &[LanguageDictionary] = &[
    flat_language!("da"),
    decade_language!(
        "de",
        (1950, 1959),
        (1960, 1969),
        (1970, 1979),
        (1980, 1989),
        (1990, 1999),
        (2000, 2009),
        (2010, 2019),
        (2020, 2029),
    ),
    flat_language!("en"),
    flat_language!("es"),
    flat_language!("fr"),
    decade_language!(
        "it",
        (1950, 1959),
        (1960, 1969),
        (1970, 1979),
        (1980, 1989),
        (1990, 1999),
        (2000, 2009),
        (2010, 2019),
    ),
    flat_language!("nl"),
    decade_language!(
        "ro",
        (1950, 1959),
        (1960, 1969),
        (1970, 1979),
        (1980, 1989),
        (1990, 1999),
        (2000, 2009),
        (2010, 2019),
    ),
    flat_language!("sv"),
    flat_language!("ur"),
    flat_language!("fa"),
];

/// The dictionary of a language (case-insensitive code); an unknown or empty code gives English.
pub(crate) fn resolve(code: &str) -> &'static LanguageDictionary {
    let by_code = |wanted: &str| DICTIONARIES.iter().find(|d| d.code.eq_ignore_ascii_case(wanted));
    by_code(code).unwrap_or_else(|| by_code("en").expect("English dictionary must be registered"))
}

/// The codes of the bundled languages, in registry order.
pub(crate) fn available_codes() -> Vec<&'static str> {
    DICTIONARIES.iter().map(|d| d.code).collect()
}

/// The trimmed, non-empty lines of an embedded name file.
fn parse_names(raw: &'static str) -> impl Iterator<Item = &'static str> {
    raw.lines().map(|line| line.trim()).filter(|line| !line.is_empty())
}
