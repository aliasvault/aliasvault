//! Basic character-set password generator.
//!
//! Builds a character set from the enabled options, generates an initial password using an
//! unbiased CSPRNG, and then ensures at least one character from every enabled set is
//! present (as some websites require this).

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

    let mut password = generate_initial_password(&chars, settings.length as usize, rng);
    ensure_requirements(&mut password, settings, rng);

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

/// Generate the initial random password from the character set.
fn generate_initial_password<R: RngCore + ?Sized>(
    chars: &[char],
    length: usize,
    rng: &mut R,
) -> Vec<char> {
    (0..length)
        .map(|_| chars[unbiased_index(rng, chars.len())])
        .collect()
}

/// Ensure the generated password contains at least one character from each enabled set.
fn ensure_requirements<R: RngCore + ?Sized>(
    password: &mut Vec<char>,
    settings: &PasswordSettings,
    rng: &mut R,
) {
    if settings.use_lowercase && !password.iter().any(|c| c.is_ascii_lowercase()) {
        add_character_from_set(password, &safe_character_set(LOWERCASE_CHARS, settings), rng);
    }
    if settings.use_uppercase && !password.iter().any(|c| c.is_ascii_uppercase()) {
        add_character_from_set(password, &safe_character_set(UPPERCASE_CHARS, settings), rng);
    }
    if settings.use_numbers && !password.iter().any(|c| c.is_ascii_digit()) {
        add_character_from_set(password, &safe_character_set(NUMBER_CHARS, settings), rng);
    }
    if settings.use_special_chars && !password.iter().any(|c| SPECIAL_CHARS.contains(*c)) {
        add_character_from_set(password, &safe_character_set(SPECIAL_CHARS, settings), rng);
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

/// Replace a random position in the password with a character from the given set.
fn add_character_from_set<R: RngCore + ?Sized>(
    password: &mut [char],
    char_set: &[char],
    rng: &mut R,
) {
    if password.is_empty() || char_set.is_empty() {
        return;
    }
    let pos = unbiased_index(rng, password.len());
    password[pos] = char_set[unbiased_index(rng, char_set.len())];
}
