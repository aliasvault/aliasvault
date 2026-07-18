//! Basic character-set password generator.
//!
//! Builds a character set from the enabled options and constructs the password so that it
//! is guaranteed to contain at least one character from every enabled set (as some websites
//! require this).

use rand::RngCore;

use super::{unbiased_index, PasswordSettings};

const LOWERCASE_CHARS: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE_CHARS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBER_CHARS: &str = "0123456789";
const SPECIAL_CHARS: &str = "!@#$%^&*()_+-=[]{}|;:,.<>?";

/// Ambiguous characters that look similar and are easy to confuse when typing.
const AMBIGUOUS_CHARS: &str = "Il1O0oZzSsBbGg2568|[]{}()<>;:,.`'\"_-";

/// Generate a basic password based on the supplied settings.
pub fn generate<R: RngCore + ?Sized>(settings: &PasswordSettings, rng: &mut R) -> String {
    let chars = build_character_set(settings);
    let length = settings.length as usize;

    // Reserve one mandatory character per enabled class so the result is guaranteed to
    // contain at least one of each.
    let mut mandatory = mandatory_characters(settings, rng);

    // If the requested length cannot fit every mandatory character (e.g. length 2 with four
    // enabled classes), shuffle and truncate so we never exceed the requested length. Which
    // classes "win" is then random rather than always favouring the same ones.
    if mandatory.len() > length {
        shuffle(&mut mandatory, rng);
        mandatory.truncate(length);
    }

    // Fill the remaining positions from the full character set, then shuffle so the mandatory
    // characters are not clustered at the front.
    let mut password = mandatory;
    while password.len() < length {
        password.push(chars[unbiased_index(rng, chars.len())]);
    }
    shuffle(&mut password, rng);

    password.into_iter().collect()
}

/// Build the character set based on the selected options.
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

    // Ensure at least one character set is selected, otherwise default to lowercase.
    if chars.is_empty() {
        chars.push_str(LOWERCASE_CHARS);
    }

    let mut set: Vec<char> = chars.chars().collect();

    // Remove ambiguous characters if needed.
    if settings.use_non_ambiguous_chars {
        set = remove_ambiguous_characters(&set);
    }

    set
}

/// Remove ambiguous characters from a character set.
fn remove_ambiguous_characters(chars: &[char]) -> Vec<char> {
    chars
        .iter()
        .copied()
        .filter(|c| !AMBIGUOUS_CHARS.contains(*c))
        .collect()
}

/// Collect one mandatory character per enabled class, so the constructed password is
/// guaranteed to contain at least one character from each.
fn mandatory_characters<R: RngCore + ?Sized>(
    settings: &PasswordSettings,
    rng: &mut R,
) -> Vec<char> {
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

/// Pick one random character from the (ambiguity-filtered) class set and push it onto `out`.
fn push_one<R: RngCore + ?Sized>(
    out: &mut Vec<char>,
    char_set: &str,
    settings: &PasswordSettings,
    rng: &mut R,
) {
    let safe = safe_character_set(char_set, settings);
    if !safe.is_empty() {
        out.push(safe[unbiased_index(rng, safe.len())]);
    }
}

/// Get a character set with ambiguous characters removed if the option is enabled.
fn safe_character_set(char_set: &str, settings: &PasswordSettings) -> Vec<char> {
    let chars: Vec<char> = char_set.chars().collect();
    if !settings.use_non_ambiguous_chars {
        return chars;
    }
    remove_ambiguous_characters(&chars)
}

/// Shuffle a slice in place with an unbiased Fisher–Yates shuffle, reusing [`unbiased_index`]
/// so the result stays deterministic under a fixed seed.
fn shuffle<R: RngCore + ?Sized>(items: &mut [char], rng: &mut R) {
    for i in (1..items.len()).rev() {
        let j = unbiased_index(rng, i + 1);
        items.swap(i, j);
    }
}
