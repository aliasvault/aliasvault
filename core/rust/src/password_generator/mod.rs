//! Cross-platform password and passphrase (Diceware) generation.
//!
//! This module is the single source of truth for password generation across AliasVault.
//! It accepts a JSON-serialized [`PasswordSettings`] object and returns the generated
//! password/passphrase as a string, matching the JSON-in/string-out convention used by
//! the other core modules.
//!
//! Two generators are supported, selected by the `Type` field:
//! - **Basic** (`basic`): a configurable character-set password.
//! - **Diceware** (`diceware`): a memorable passphrase built from a wordlist.

mod basic;
pub mod defaults;
mod diceware;
mod wordlists;

#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

use crate::error::VaultError;
use crate::rng::{make_rng, unbiased_index};

/// Which generator to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum GeneratorType {
    /// Character-set password generator.
    #[default]
    Basic,
    /// Diceware passphrase generator.
    Diceware,
}

/// Capitalization applied to each Diceware word.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
pub enum Capitalization {
    /// Leave each word as-is.
    None,
    /// Uppercase the first letter of each word, lowercase the rest.
    TitleCase,
    /// Uppercase every letter.
    Uppercase,
    /// Lowercase every letter (default, matches the UI default).
    #[default]
    Lowercase,
    /// Randomize the capitalization of each letter.
    Random,
}

/// Separator placed between Diceware words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
pub enum Separator {
    /// No separator (words are concatenated).
    None,
    /// A dash (default, matches the UI default).
    #[default]
    Dash,
    /// A space.
    Space,
    /// An underscore.
    Underscore,
    /// A dot.
    Dot,
}

/// Optional random salt character added to a Diceware passphrase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
pub enum Salt {
    /// No salt (default).
    #[default]
    None,
    /// Prepend a random alphanumeric character.
    Prefix,
    /// Insert a random alphanumeric character at a random position.
    Sprinkle,
    /// Append a random alphanumeric character.
    Suffix,
}

/// Settings controlling password/passphrase generation.
///
/// Field names use PascalCase to match the JSON blob persisted by the apps under the
/// `PasswordGenerationSettings` settings key. Every field has a serde default so that
/// older blobs (which lack the Diceware fields) deserialize cleanly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct PasswordSettings {
    /// Which generator to use.
    #[serde(rename = "Type", default)]
    pub generator_type: GeneratorType,

    // --- Basic generator ---
    /// Length of the generated password.
    #[serde(default = "default_length")]
    pub length: u32,
    /// Whether to include lowercase letters.
    #[serde(default = "default_true")]
    pub use_lowercase: bool,
    /// Whether to include uppercase letters.
    #[serde(default = "default_true")]
    pub use_uppercase: bool,
    /// Whether to include numbers.
    #[serde(default = "default_true")]
    pub use_numbers: bool,
    /// Whether to include special characters.
    #[serde(default = "default_true")]
    pub use_special_chars: bool,
    /// Whether to exclude ambiguous characters.
    #[serde(default)]
    pub use_non_ambiguous_chars: bool,

    // --- Diceware generator ---
    /// Number of words in the passphrase.
    #[serde(default = "default_word_count")]
    pub word_count: u32,
    /// Wordlist language code (free text, case-insensitive). Unknown codes fall back to
    /// English, so the TypeScript model and apps never need updating to add a language.
    #[serde(default = "default_language")]
    pub language: String,
    /// Capitalization applied to each word.
    #[serde(default)]
    pub capitalization: Capitalization,
    /// Separator between words.
    #[serde(default)]
    pub separator: Separator,
    /// Optional random salt character.
    #[serde(default)]
    pub salt: Salt,

    /// Optional 32-byte RNG seed as a 64-character hex string.
    ///
    /// When supplied, generation is deterministic: the same seed yields the same output,
    /// so the UI can re-apply formatting options (separator, capitalization, salt, word
    /// count) to the *same* underlying words for easy comparison. When absent, a fresh
    /// random seed is drawn from the OS CSPRNG, so output is non-deterministic by default.
    #[serde(default)]
    pub seed: Option<String>,
}

fn default_length() -> u32 {
    defaults::DEFAULT_PASSWORD_LENGTH
}

fn default_word_count() -> u32 {
    defaults::DEFAULT_WORD_COUNT
}

/// Minimum values for the password and passphrase length.
const HARD_MIN_PASSWORD_LENGTH: u32 = 1;
const HARD_MIN_WORD_COUNT: u32 = 1;

fn default_true() -> bool {
    true
}

fn default_language() -> String {
    "en".to_string()
}

/// List the language codes of all bundled Diceware wordlists (first is the default, English).
pub fn available_languages() -> Vec<String> {
    wordlists::available_codes()
        .into_iter()
        .map(|c| c.to_string())
        .collect()
}

/// Generate a password or passphrase from a JSON-serialized [`PasswordSettings`].
///
/// Returns the generated string, or a [`VaultError`] if the settings JSON is invalid.
pub fn generate_password(settings_json: &str) -> Result<String, VaultError> {
    let settings: PasswordSettings = serde_json::from_str(settings_json)?;
    Ok(generate_from_settings(&settings))
}

/// Generate a password or passphrase from already-parsed settings.
pub fn generate_from_settings(settings: &PasswordSettings) -> String {
    let mut rng = make_rng(settings.seed.as_deref());

    // Limit the maximum values for the password and passphrase length.
    let mut settings = settings.clone();
    settings.length = settings
        .length
        .clamp(HARD_MIN_PASSWORD_LENGTH, defaults::MAX_PASSWORD_LENGTH);
    settings.word_count = settings
        .word_count
        .clamp(HARD_MIN_WORD_COUNT, defaults::MAX_WORD_COUNT);

    match settings.generator_type {
        GeneratorType::Basic => basic::generate(&settings, &mut rng),
        GeneratorType::Diceware => diceware::generate(&settings, &mut rng),
    }
}

