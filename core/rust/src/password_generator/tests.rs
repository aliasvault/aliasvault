//! Tests for password and passphrase generation.

use super::*;

/// Build a default settings object (matches the app defaults).
fn default_settings() -> PasswordSettings {
    serde_json::from_str("{}").expect("empty object should deserialize via serde defaults")
}

#[test]
fn empty_json_uses_defaults() {
    let s = default_settings();
    assert_eq!(s.generator_type, GeneratorType::Basic);
    assert_eq!(s.length, 18);
    assert!(s.use_lowercase && s.use_uppercase && s.use_numbers && s.use_special_chars);
    assert!(!s.use_non_ambiguous_chars);
    assert_eq!(s.word_count, 4);
    assert_eq!(s.language, "English");
    assert_eq!(s.capitalization, Capitalization::Lowercase);
    assert_eq!(s.separator, Separator::Dash);
    assert_eq!(s.salt, Salt::None);
}

#[test]
fn type_field_round_trips_as_pascal_key() {
    // The persisted JSON key must be exactly "Type" with lowercase values.
    let json = r#"{"Type":"diceware"}"#;
    let s: PasswordSettings = serde_json::from_str(json).unwrap();
    assert_eq!(s.generator_type, GeneratorType::Diceware);

    let out = serde_json::to_string(&s).unwrap();
    assert!(out.contains("\"Type\":\"diceware\""), "serialized: {out}");
}

#[test]
fn basic_respects_length() {
    let json = r#"{"Type":"basic","Length":24}"#;
    let pw = generate_password(json).unwrap();
    assert_eq!(pw.chars().count(), 24);
}

#[test]
fn basic_includes_each_enabled_class() {
    let json = r#"{"Type":"basic","Length":40,"UseLowercase":true,"UseUppercase":true,"UseNumbers":true,"UseSpecialChars":true}"#;
    let pw = generate_password(json).unwrap();
    assert!(pw.chars().any(|c| c.is_ascii_lowercase()));
    assert!(pw.chars().any(|c| c.is_ascii_uppercase()));
    assert!(pw.chars().any(|c| c.is_ascii_digit()));
    assert!(pw.chars().any(|c| "!@#$%^&*()_+-=[]{}|;:,.<>?".contains(c)));
}

#[test]
fn basic_only_numbers_yields_only_digits() {
    let json = r#"{"Type":"basic","Length":30,"UseLowercase":false,"UseUppercase":false,"UseNumbers":true,"UseSpecialChars":false}"#;
    let pw = generate_password(json).unwrap();
    assert!(pw.chars().all(|c| c.is_ascii_digit()));
}

#[test]
fn basic_no_classes_falls_back_to_lowercase() {
    let json = r#"{"Type":"basic","Length":20,"UseLowercase":false,"UseUppercase":false,"UseNumbers":false,"UseSpecialChars":false}"#;
    let pw = generate_password(json).unwrap();
    assert_eq!(pw.chars().count(), 20);
    assert!(pw.chars().all(|c| c.is_ascii_lowercase()));
}

#[test]
fn basic_non_ambiguous_excludes_ambiguous_chars() {
    let ambiguous = "Il1O0oZzSsBbGg2568|[]{}()<>;:,.`'\"_-";
    let json = r#"{"Type":"basic","Length":80,"UseNonAmbiguousChars":true}"#;
    // Run several times since generation is random.
    for _ in 0..20 {
        let pw = generate_password(json).unwrap();
        assert!(
            pw.chars().all(|c| !ambiguous.contains(c)),
            "found ambiguous char in {pw}"
        );
    }
}

#[test]
fn diceware_word_count_and_separator() {
    let json = r#"{"Type":"diceware","WordCount":5,"Separator":"Dash","Capitalization":"Lowercase","Salt":"None"}"#;
    let pw = generate_password(json).unwrap();
    let parts: Vec<&str> = pw.split('-').collect();
    assert_eq!(parts.len(), 5);
    assert!(parts.iter().all(|p| !p.is_empty()));
}

#[test]
fn diceware_capitalization_title_case() {
    let json = r#"{"Type":"diceware","WordCount":3,"Separator":"Space","Capitalization":"TitleCase","Salt":"None"}"#;
    let pw = generate_password(json).unwrap();
    for word in pw.split(' ') {
        let mut chars = word.chars();
        if let Some(first) = chars.next() {
            assert!(first.is_uppercase() || !first.is_alphabetic());
        }
    }
}

#[test]
fn diceware_separator_none_concatenates() {
    let json = r#"{"Type":"diceware","WordCount":3,"Separator":"None","Salt":"None"}"#;
    let pw = generate_password(json).unwrap();
    assert!(!pw.contains('-') && !pw.contains(' ') && !pw.contains('_'));
    assert!(!pw.is_empty());
}

#[test]
fn diceware_salt_suffix_appends_alphanumeric() {
    let json = r#"{"Type":"diceware","WordCount":2,"Separator":"Dash","Salt":"Suffix"}"#;
    let pw = generate_password(json).unwrap();
    let last = pw.chars().last().unwrap();
    assert!(last.is_ascii_alphanumeric());
}

const TEST_SEED: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

#[test]
fn same_seed_yields_same_output() {
    let json = format!(r#"{{"Type":"diceware","WordCount":5,"Seed":"{TEST_SEED}"}}"#);
    let a = generate_password(&json).unwrap();
    let b = generate_password(&json).unwrap();
    assert_eq!(a, b);
}

#[test]
fn same_seed_different_separator_keeps_words() {
    // With the same seed, only the separator should change — the words stay identical.
    let dash = generate_password(&format!(
        r#"{{"Type":"diceware","WordCount":4,"Separator":"Dash","Seed":"{TEST_SEED}"}}"#
    ))
    .unwrap();
    let dot = generate_password(&format!(
        r#"{{"Type":"diceware","WordCount":4,"Separator":"Dot","Seed":"{TEST_SEED}"}}"#
    ))
    .unwrap();

    let dash_words: Vec<&str> = dash.split('-').collect();
    let dot_words: Vec<&str> = dot.split('.').collect();
    assert_eq!(dash_words, dot_words);
    assert_ne!(dash, dot);
}

#[test]
fn invalid_seed_falls_back_to_random() {
    // A malformed seed must not error — it falls back to a random seed.
    let pw = generate_password(r#"{"Type":"diceware","Seed":"not-hex"}"#).unwrap();
    assert!(!pw.is_empty());
}

#[test]
fn all_wordlists_have_7776_words() {
    for code in wordlists::available_codes() {
        let words = wordlists::list(code);
        assert_eq!(words.len(), 7776, "{code} should have 7776 words");
    }
}

#[test]
fn unknown_language_falls_back_to_english() {
    // Case-insensitive match, and an unknown code must not error.
    assert_eq!(wordlists::list("english"), wordlists::list("English"));
    assert_eq!(wordlists::list("Klingon"), wordlists::list("English"));
    let pw = generate_password(r#"{"Type":"diceware","Language":"Klingon"}"#).unwrap();
    assert!(!pw.is_empty());
}
