//! Diceware passphrase generator.
//!
//! Ported from the MIT-licensed `SpamOK.PasswordGenerator` Diceware algorithm. Picks
//! `word_count` words uniformly at random from the selected language wordlist, applies
//! capitalization, joins them with a separator, and optionally adds a random alphanumeric
//! "salt" character.

use rand::RngCore;

use super::{unbiased_index, wordlists, Capitalization, PasswordSettings, Salt, Separator};

const ALPHANUMERIC: &str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/// Generate a Diceware passphrase based on the supplied settings.
pub fn generate<R: RngCore + ?Sized>(settings: &PasswordSettings, rng: &mut R) -> String {
    let words = wordlists::list(&settings.language);

    let chosen: Vec<String> = (0..settings.word_count)
        .map(|_| {
            let word = words[unbiased_index(rng, words.len())];
            capitalize_word(word, settings.capitalization, rng)
        })
        .collect();

    let passphrase = match separator_char(settings.separator) {
        Some(sep) => chosen.join(&sep.to_string()),
        None => chosen.concat(),
    };

    add_salt(passphrase, settings.salt, rng)
}

/// Map a separator option to its character (`None` means no separator at all).
fn separator_char(separator: Separator) -> Option<char> {
    match separator {
        Separator::None => None,
        Separator::Dash => Some('-'),
        Separator::Space => Some(' '),
        Separator::Underscore => Some('_'),
        Separator::Dot => Some('.'),
    }
}

/// Apply the configured capitalization to a single word.
fn capitalize_word<R: RngCore + ?Sized>(
    word: &str,
    capitalization: Capitalization,
    rng: &mut R,
) -> String {
    match capitalization {
        Capitalization::None => word.to_string(),
        Capitalization::Lowercase => word.to_lowercase(),
        Capitalization::Uppercase => word.to_uppercase(),
        Capitalization::TitleCase => {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => {
                    first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
                }
                None => String::new(),
            }
        }
        Capitalization::Random => word
            .chars()
            .map(|c| {
                if c.is_alphabetic() && unbiased_index(rng, 2) == 1 {
                    c.to_uppercase().collect::<String>()
                } else {
                    c.to_string()
                }
            })
            .collect(),
    }
}

/// Add a random alphanumeric salt character to the passphrase based on the salt option.
fn add_salt<R: RngCore + ?Sized>(passphrase: String, salt: Salt, rng: &mut R) -> String {
    if matches!(salt, Salt::None) {
        return passphrase;
    }

    let salt_chars: Vec<char> = ALPHANUMERIC.chars().collect();
    let salt_char = salt_chars[unbiased_index(rng, salt_chars.len())];

    match salt {
        Salt::Prefix => format!("{}{}", salt_char, passphrase),
        Salt::Suffix => format!("{}{}", passphrase, salt_char),
        Salt::Sprinkle => {
            let mut chars: Vec<char> = passphrase.chars().collect();
            let index = unbiased_index(rng, chars.len() + 1);
            chars.insert(index, salt_char);
            chars.into_iter().collect()
        }
        Salt::None => passphrase,
    }
}
