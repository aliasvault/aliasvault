//! Username and email prefix generation from a name and birth year.

use rand::Rng;

use crate::common::rng::unbiased_index;

const MIN_LENGTH: usize = 6;
const MAX_LENGTH: usize = 20;
const SYMBOLS: [char; 2] = ['.', '-'];
const RANDOM_CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

/// Generate an email prefix from a first name, last name and optional birth year.
pub fn generate_email_prefix<R: Rng + ?Sized>(rng: &mut R, first_name: &str, last_name: &str, birth_year: Option<i32>) -> String {
    let first = first_name.to_lowercase();
    let last = last_name.to_lowercase();

    let name_part = match unbiased_index(rng, 4) {
        0 => format!("{}{}", first_chars(&first, 1), last),
        1 => format!("{}{}", first, last),
        2 => format!("{}{}", first, first_chars(&last, 1)),
        _ => format!("{}{}", first_chars(&first, 3), last),
    };

    let mut parts = vec![name_part];

    if let Some(year) = birth_year {
        let year = year.to_string();
        parts.push(match unbiased_index(rng, 2) {
            0 => year,
            _ => year.chars().skip(year.len().saturating_sub(2)).collect(),
        });
    }

    let mut prefix = parts.join(&random_symbol(rng));

    // One extra symbol at a random position, half of the time.
    if unbiased_index(rng, 2) == 0 && !prefix.is_empty() {
        let char_count = prefix.chars().count();
        let position = unbiased_index(rng, char_count);
        let byte_index = prefix.char_indices().nth(position).map(|(i, _)| i).unwrap_or(prefix.len());
        prefix.insert_str(byte_index, &random_symbol(rng));
    }

    prefix = sanitize_email_prefix(&prefix);
    adjust_length(rng, prefix)
}

/// Generate a username: an email prefix from its own random rolls, stripped to ASCII alphanumerics.
pub fn generate_username<R: Rng + ?Sized>(rng: &mut R, first_name: &str, last_name: &str, birth_year: Option<i32>) -> String {
    let prefix = generate_email_prefix(rng, first_name, last_name, birth_year);
    let username: String = prefix.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    adjust_length(rng, username)
}

/// A random string of lowercase letters and digits.
pub fn generate_random_string<R: Rng + ?Sized>(rng: &mut R, length: usize) -> String {
    (0..length).map(|_| RANDOM_CHARS[unbiased_index(rng, RANDOM_CHARS.len())] as char).collect()
}

/// Pad a too-short value with random characters or truncate a too-long one.
fn adjust_length<R: Rng + ?Sized>(rng: &mut R, mut value: String) -> String {
    let char_count = value.chars().count();
    if char_count < MIN_LENGTH {
        value.push_str(&generate_random_string(rng, MIN_LENGTH - char_count));
    } else if char_count > MAX_LENGTH {
        value = value.chars().take(MAX_LENGTH).collect();
    }
    value
}

/// A random symbol one time in three, otherwise an empty string.
fn random_symbol<R: Rng + ?Sized>(rng: &mut R) -> String {
    if unbiased_index(rng, 3) == 0 {
        SYMBOLS[unbiased_index(rng, SYMBOLS.len())].to_string()
    } else {
        String::new()
    }
}

/// Keep only ASCII letters, digits, dots, underscores and hyphens; collapse runs of separators and trim them from the ends.
fn sanitize_email_prefix(input: &str) -> String {
    let filtered: String = input.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')).collect();

    let mut collapsed = String::with_capacity(filtered.len());
    let mut previous_was_separator = false;
    for c in filtered.chars() {
        let is_separator = matches!(c, '.' | '_' | '-');
        if is_separator && previous_was_separator {
            continue;
        }
        collapsed.push(c);
        previous_was_separator = is_separator;
    }

    collapsed.trim_matches(|c: char| matches!(c, '.' | '_' | '-')).to_string()
}

/// The first `n` characters of a string.
fn first_chars(value: &str, n: usize) -> String {
    value.chars().take(n).collect()
}
