//! Tests for the identity generator;

use super::*;

const SEED_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SEED_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn request(language: &str) -> IdentityRequest {
    IdentityRequest {
        language: language.to_string(),
        ..Default::default()
    }
}

fn birth_year_of(identity: &Identity) -> i32 {
    identity.birth_date[..4].parse().unwrap()
}

#[test]
fn generates_valid_identity_for_each_language() {
    for language in dictionaries::available_codes() {
        let identity = generate_from_request(&request(language));

        assert!(identity.first_name.chars().count() > 1, "{language}: first name too short");
        assert!(identity.last_name.chars().count() > 1, "{language}: last name too short");
        assert!(
            identity.gender == GENDER_MALE || identity.gender == GENDER_FEMALE,
            "{language}: unexpected gender {}",
            identity.gender
        );
        assert!(!identity.birth_date.is_empty(), "{language}: empty birth date");
        assert!(!identity.email_prefix.is_empty(), "{language}: empty email prefix");
        assert!(!identity.nick_name.is_empty(), "{language}: empty nickname");
    }
}

#[test]
fn consecutive_identities_differ() {
    let first = generate_from_request(&request("en"));
    let second = generate_from_request(&request("en"));
    assert!(
        first.first_name != second.first_name
            || first.last_name != second.last_name
            || first.birth_date != second.birth_date
            || first.email_prefix != second.email_prefix,
        "two consecutive identities were identical"
    );
}

#[test]
fn seeded_generation_is_deterministic() {
    let mut req = request("en");
    req.seed = Some(SEED_A.to_string());

    let first = generate_from_request(&req);
    let second = generate_from_request(&req);
    assert_eq!(first.first_name, second.first_name);
    assert_eq!(first.last_name, second.last_name);
    assert_eq!(first.birth_date, second.birth_date);
    assert_eq!(first.email_prefix, second.email_prefix);
    assert_eq!(first.nick_name, second.nick_name);

    req.seed = Some(SEED_B.to_string());
    let third = generate_from_request(&req);
    assert!(
        first.first_name != third.first_name || first.birth_date != third.birth_date,
        "different seeds should produce different identities"
    );
}

#[test]
fn gender_preference_is_respected() {
    for _ in 0..10 {
        let mut req = request("en");
        req.gender = Some("male".to_string());
        assert_eq!(generate_from_request(&req).gender, GENDER_MALE);

        req.gender = Some("female".to_string());
        assert_eq!(generate_from_request(&req).gender, GENDER_FEMALE);
    }
}

#[test]
fn default_birth_date_is_between_21_and_65_years_ago() {
    let today = Utc::now().date_naive();
    for _ in 0..50 {
        let identity = generate_from_request(&request("en"));
        let year = birth_year_of(&identity);
        assert!(year >= today.year() - 66, "birth year {year} too old");
        assert!(year <= today.year() - 20, "birth year {year} too young");
    }
}

#[test]
fn birthdate_options_zero_deviation_pins_the_year() {
    let mut req = request("en");
    req.birthdate_options = Some(BirthdateOptions {
        target_year: 1990,
        year_deviation: 0,
    });

    for _ in 0..25 {
        let identity = generate_from_request(&req);
        assert_eq!(birth_year_of(&identity), 1990);
    }
}

#[test]
fn birthdate_options_deviation_bounds_the_year_range() {
    let mut req = request("en");
    req.birthdate_options = Some(BirthdateOptions {
        target_year: 1990,
        year_deviation: 5,
    });

    let mut distinct_years = std::collections::HashSet::new();
    for _ in 0..50 {
        let identity = generate_from_request(&req);
        let year = birth_year_of(&identity);
        assert!((1985..=1995).contains(&year), "year {year} out of range");
        distinct_years.insert(year);
    }
    assert!(distinct_years.len() > 1, "expected varied years within the range");
}

#[test]
fn german_decade_names_follow_the_birth_year() {
    for target_year in (1955..=2025).step_by(10) {
        let mut req = request("de");
        req.birthdate_options = Some(BirthdateOptions {
            target_year,
            year_deviation: 0,
        });

        let identity = generate_from_request(&req);
        assert_eq!(birth_year_of(&identity), target_year);
        assert!(!identity.first_name.is_empty());
        assert!(!identity.last_name.is_empty());
    }
}

#[test]
fn decade_language_falls_back_to_all_decades_for_uncovered_years() {
    // Italian decades stop at 2019, so a 2024 birth year has no direct match.
    let mut req = request("it");
    req.birthdate_options = Some(BirthdateOptions {
        target_year: 2024,
        year_deviation: 0,
    });

    let identity = generate_from_request(&req);
    assert!(!identity.first_name.is_empty());
}

#[test]
fn unknown_language_falls_back_to_english() {
    let identity = generate_from_request(&request("xx"));
    assert!(!identity.first_name.is_empty());
    assert!(!identity.last_name.is_empty());
}

#[test]
fn age_range_is_used_when_no_birthdate_options_given() {
    let current_year = Utc::now().year();
    let mut req = request("en");
    req.age_range = Some("21-25".to_string());

    for _ in 0..25 {
        let identity = generate_from_request(&req);
        let age = current_year - birth_year_of(&identity);
        assert!((20..=26).contains(&age), "age {age} outside expected 21-25 window");
    }
}

#[test]
fn age_range_conversion_matches_reference_values() {
    let cases = [
        ("21-25", 2002, 2),
        ("26-30", 1997, 2),
        ("61-65", 1962, 2),
        ("25-25", 2000, 0),
        ("20-24", 2003, 2),
    ];
    for (range, target_year, year_deviation) in cases {
        let options = age_range_to_birthdate_options_at(range, 2025).unwrap();
        assert_eq!(options.target_year, target_year, "range {range}");
        assert_eq!(options.year_deviation, year_deviation, "range {range}");
    }
}

#[test]
fn age_range_conversion_rejects_invalid_input() {
    for input in ["random", "", "2125", "21-25-30", "abc-def", "21-abc"] {
        assert!(
            age_range_to_birthdate_options_at(input, 2025).is_none(),
            "expected None for {input:?}"
        );
    }
}

#[test]
fn available_age_ranges_starts_with_random() {
    let ranges = available_age_ranges();
    assert_eq!(ranges[0], "random");
    assert!(ranges.contains(&"21-25".to_string()));
    assert!(ranges.contains(&"61-65".to_string()));
    assert_eq!(ranges.len(), 10);
}

#[test]
fn available_languages_contains_all_dictionaries() {
    let languages = available_languages();
    assert_eq!(languages.len(), 11);
    for code in ["da", "de", "en", "es", "fr", "it", "nl", "ro", "sv", "ur", "fa"] {
        assert!(languages.contains(&code.to_string()), "missing language {code}");
    }
}

#[test]
fn all_dictionaries_have_names_for_both_genders() {
    for dictionary in dictionaries::DICTIONARIES {
        assert!(!dictionary.lastnames().is_empty(), "{}: no last names", dictionary.code);

        let male = select_firstnames_for_birth_year(dictionary, 1990, true);
        let female = select_firstnames_for_birth_year(dictionary, 1990, false);
        assert!(!male.is_empty(), "{}: no male first names", dictionary.code);
        assert!(!female.is_empty(), "{}: no female first names", dictionary.code);
    }
}

#[test]
fn email_prefix_is_sanitized_and_length_clamped() {
    for i in 0..100 {
        let seed = format!("{:064x}", i + 1);
        let input = format!(
            r#"{{"firstName":"Jürgen","lastName":"O'Brien-Smith","birthDate":"1985-03-12","seed":"{seed}"}}"#
        );
        let prefix = generate_email_prefix(&input).unwrap();
        let count = prefix.chars().count();
        assert!((6..=20).contains(&count), "prefix {prefix:?} has bad length");
        assert!(
            prefix
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')),
            "prefix {prefix:?} contains invalid characters"
        );
        assert!(!prefix.starts_with(['.', '-', '_']), "prefix {prefix:?} starts with separator");
        assert!(!prefix.ends_with(['.', '-', '_']), "prefix {prefix:?} ends with separator");
    }
}

#[test]
fn username_is_alphanumeric_and_length_clamped() {
    for i in 0..100 {
        let seed = format!("{:064x}", i + 1);
        let input = format!(
            r#"{{"firstName":"Anna-Marie","lastName":"de Vries","birthDate":"1992-11-30","seed":"{seed}"}}"#
        );
        let username = generate_username(&input).unwrap();
        let count = username.chars().count();
        assert!((6..=20).contains(&count), "username {username:?} has bad length");
        assert!(
            username.chars().all(|c| c.is_ascii_alphanumeric()),
            "username {username:?} contains non-alphanumeric characters"
        );
    }
}

#[test]
fn username_and_email_prefix_work_without_birth_year() {
    let input = r#"{"firstName":"John","lastName":"Doe","birthDate":""}"#;
    let username = generate_username(input).unwrap();
    let prefix = generate_email_prefix(input).unwrap();
    assert!((6..=20).contains(&username.chars().count()));
    assert!((6..=20).contains(&prefix.chars().count()));
}

#[test]
fn random_email_prefix_has_requested_length_and_charset() {
    let prefix = generate_random_email_prefix(14);
    assert_eq!(prefix.chars().count(), 14);
    assert!(prefix.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
}

#[test]
fn json_api_round_trips_with_camel_case_fields() {
    let output = generate_identity(r#"{"language":"nl","gender":"female","ageRange":"26-30"}"#).unwrap();
    let value: serde_json::Value = serde_json::from_str(&output).unwrap();

    for field in ["firstName", "lastName", "gender", "birthDate", "emailPrefix", "nickName"] {
        assert!(value.get(field).is_some(), "missing field {field}");
    }
    assert_eq!(value["gender"], "Female");

    let birth_date = value["birthDate"].as_str().unwrap();
    assert_eq!(birth_date.len(), 10, "birthDate should be yyyy-MM-dd, got {birth_date}");
}

#[test]
fn json_api_rejects_malformed_input() {
    assert!(generate_identity("not json").is_err());
    assert!(generate_username("{").is_err());
}
