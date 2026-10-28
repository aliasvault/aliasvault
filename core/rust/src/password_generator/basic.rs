//! Character-set password generator; the result contains at least one character of every enabled class.

use rand::Rng;

use super::{unbiased_index, PasswordSettings};

const LOWERCASE_CHARS: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE_CHARS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBER_CHARS: &str = "0123456789";
const SPECIAL_CHARS: &str = "!@#$%^&*()_+-=[]{}|;:,.<>?";

/// Characters that are easy to confuse when reading or typing.
const AMBIGUOUS_CHARS: &str = "Il1O0oZzSsBbGg2568|[]{}()<>;:,.`'\"_-";

/// Generate a password from the supplied settings.
pub fn generate<R: Rng + ?Sized>(settings: &PasswordSettings, rng: &mut R) -> String {
    let chars = build_character_set(settings);
    let length = settings.length as usize;

    // When the length cannot fit one character per enabled class, a random subset of the classes wins.
    let mut mandatory = mandatory_characters(settings, rng);
    if mandatory.len() > length {
        shuffle(&mut mandatory, rng);
        mandatory.truncate(length);
    }

    let mut password = mandatory;
    while password.len() < length {
        password.push(chars[unbiased_index(rng, chars.len())]);
    }
    shuffle(&mut password, rng);

    password.into_iter().collect()
}

/// The character set of the enabled classes, lowercase when none is enabled.
fn build_character_set(settings: &PasswordSettings) -> Vec<char> {
    let mut chars = String::new();

    if settings.use_lowercase {
        chars.push_str(LOWERCASE_CHARS);
    }
    if settings.use_uppercase {
        chars.push_str(UPPERCASE_CHARS);
    }
    if settings.use_numbers {
        chars.push_str(NUMBER_CHARS);
    }
    if settings.use_special_chars {
        chars.push_str(SPECIAL_CHARS);
    }

    if chars.is_empty() {
        chars.push_str(LOWERCASE_CHARS);
    }

    let safe = safe_character_set(&chars, settings);
    if !safe.is_empty() {
        return safe;
    }

    // Every enabled character was excluded: ignore the exclusions rather than produce nothing.
    chars.chars().filter(|c| !settings.use_non_ambiguous_chars || !AMBIGUOUS_CHARS.contains(*c)).collect()
}

/// One random character per enabled class.
fn mandatory_characters<R: Rng + ?Sized>(settings: &PasswordSettings, rng: &mut R) -> Vec<char> {
    let mut mandatory = Vec::new();
    if settings.use_lowercase {
        push_one(&mut mandatory, LOWERCASE_CHARS, settings, rng);
    }
    if settings.use_uppercase {
        push_one(&mut mandatory, UPPERCASE_CHARS, settings, rng);
    }
    if settings.use_numbers {
        push_one(&mut mandatory, NUMBER_CHARS, settings, rng);
    }
    if settings.use_special_chars {
        push_one(&mut mandatory, SPECIAL_CHARS, settings, rng);
    }
    mandatory
}

/// Push one random character of `char_set` onto `out`, unless the settings exclude the whole set.
fn push_one<R: Rng + ?Sized>(out: &mut Vec<char>, char_set: &str, settings: &PasswordSettings, rng: &mut R) {
    let safe = safe_character_set(char_set, settings);
    if !safe.is_empty() {
        out.push(safe[unbiased_index(rng, safe.len())]);
    }
}

/// A character set without the excluded characters, and without the ambiguous ones when that option is on.
fn safe_character_set(char_set: &str, settings: &PasswordSettings) -> Vec<char> {
    char_set
        .chars()
        .filter(|c| !settings.excluded_chars.contains(*c))
        .filter(|c| !settings.use_non_ambiguous_chars || !AMBIGUOUS_CHARS.contains(*c))
        .collect()
}

/// Fisher-Yates shuffle over `unbiased_index`, so a seed keeps giving the same password.
fn shuffle<R: Rng + ?Sized>(items: &mut [char], rng: &mut R) {
    for i in (1..items.len()).rev() {
        let j = unbiased_index(rng, i + 1);
        items.swap(i, j);
    }
}
