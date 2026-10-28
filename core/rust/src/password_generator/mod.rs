//! Cross-platform password and passphrase (Diceware) generation.
//!
//! This module is the single source of truth for password generation across AliasVault. It accepts a JSON-serialized
//! [`PasswordSettings`] object and returns the generated password/passphrase as a string, matching the JSON-in/string-out
//! convention used by the other core modules.
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

use crate::common::error::VaultError;
use crate::common::rng::{make_rng, unbiased_index};

/// Which generator to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub(crate) enum GeneratorType {
    #[default]
    Basic,
    Diceware,
}

/// Capitalization applied to each Diceware word.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
pub enum Capitalization {
    None,
    /// First letter uppercase, the rest lowercase.
    TitleCase,
    Uppercase,
    #[default]
    Lowercase,
    /// Each letter uppercase or lowercase at random.
    Random,
}

/// Separator placed between Diceware words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
pub enum Separator {
    None,
    #[default]
    Dash,
    Space,
    Underscore,
    Dot,
}

/// Where a random alphanumeric salt character goes in a Diceware passphrase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
pub enum Salt {
    #[default]
    None,
    Prefix,
    /// At a random position.
    Sprinkle,
    Suffix,
}

/*
 * The JSON shape of the `PasswordGenerationSettings` settings blob the apps persist: PascalCase keys, and a serde
 * default on every field so blobs written before the Diceware fields existed still deserialize.
 */

/// Settings controlling password or passphrase generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(crate) struct PasswordSettings {
    #[serde(rename = "Type", default)]
    pub generator_type: GeneratorType,

    #[serde(default = "default_length")]
    pub length: u32,
    #[serde(default = "default_true")]
    pub use_lowercase: bool,
    #[serde(default = "default_true")]
    pub use_uppercase: bool,
    #[serde(default = "default_true")]
    pub use_numbers: bool,
    #[serde(default = "default_true")]
    pub use_special_chars: bool,
    #[serde(default)]
    pub use_non_ambiguous_chars: bool,
    /// Characters that must never appear in the password.
    #[serde(default)]
    pub excluded_chars: String,

    #[serde(default = "default_word_count")]
    pub word_count: u32,
    /// Wordlist language code, case-insensitive; unknown codes fall back to English.
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub capitalization: Capitalization,
    #[serde(default)]
    pub separator: Separator,
    #[serde(default)]
    pub salt: Salt,

    /// Optional 32-byte RNG seed as 64 hex characters; the same seed gives the same output.
    #[serde(default)]
    pub seed: Option<String>,
}

fn default_length() -> u32 {
    defaults::DEFAULT_PASSWORD_LENGTH
}

fn default_word_count() -> u32 {
    defaults::DEFAULT_WORD_COUNT
}

fn default_true() -> bool {
    true
}

fn default_language() -> String {
    "en".to_string()
}

// The floors the generator clamps to; the UI sliders start higher (`defaults::MIN_*`).
const HARD_MIN_PASSWORD_LENGTH: u32 = 1;
const HARD_MIN_WORD_COUNT: u32 = 1;

/// The language codes of the bundled Diceware wordlists, English first.
pub fn available_languages() -> Vec<String> {
    wordlists::available_codes().into_iter().map(|c| c.to_string()).collect()
}

/// Generate a password or passphrase from a JSON-serialized [`PasswordSettings`].
pub fn generate_password(settings_json: &str) -> Result<String, VaultError> {
    let settings: PasswordSettings = serde_json::from_str(settings_json)?;
    Ok(generate_from_settings(&settings))
}

/// Generate a password or passphrase from parsed settings.
fn generate_from_settings(settings: &PasswordSettings) -> String {
    let mut rng = make_rng(settings.seed.as_deref());

    let mut settings = settings.clone();
    settings.length = settings.length.clamp(HARD_MIN_PASSWORD_LENGTH, defaults::MAX_PASSWORD_LENGTH);
    settings.word_count = settings.word_count.clamp(HARD_MIN_WORD_COUNT, defaults::MAX_WORD_COUNT);

    match settings.generator_type {
        GeneratorType::Basic => basic::generate(&settings, &mut rng),
        GeneratorType::Diceware => diceware::generate(&settings, &mut rng),
    }
}
