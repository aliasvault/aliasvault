//! Cross-platform random identity (alias persona) generation.
//!
//! This module is the single source of truth for identity generation across AliasVault. It accepts a JSON-serialized
//! [`IdentityRequest`] and returns the generated [`Identity`] as JSON, matching the JSON-in/JSON-out convention used by the
//! other core modules.
//!
//! An identity consists of a first name, last name, gender, birth date, email prefix and nickname (username). Names are drawn
//! from embedded per-language dictionaries; for languages with decade-based dictionaries (de, it, ro) the first name is
//! matched to names that were popular around the generated birth year.

pub(crate) mod dictionaries;
mod username_email;

#[cfg(test)]
mod tests;

use chrono::{Datelike, Days, NaiveDate, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::common::error::{json_call, VaultError};
use crate::common::rng::{make_rng, unbiased_index};

pub const GENDER_MALE: &str = "Male";
pub const GENDER_FEMALE: &str = "Female";

// The age window of a generated birth date when the request names no age range or birth year.
const DEFAULT_MIN_AGE: i32 = 21;
const DEFAULT_MAX_AGE: i32 = 65;

/// The age range option values offered by the settings UIs; "random" means the default 21-65 range.
const AGE_RANGES: &[&str] = &["random", "21-25", "26-30", "31-35", "36-40", "41-45", "46-50", "51-55", "56-60", "61-65"];

/// A generated identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub first_name: String,
    pub last_name: String,
    /// "Male" or "Female".
    pub gender: String,
    /// `yyyy-MM-dd`.
    pub birth_date: String,
    pub email_prefix: String,
    /// ASCII alphanumeric only.
    pub nick_name: String,
}

/// A birth year window: a target year plus or minus a deviation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BirthdateOptions {
    pub target_year: i32,
    /// 0 keeps the birth date within the target year.
    pub year_deviation: i32,
}

/// Request controlling identity generation; every field is optional.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct IdentityRequest {
    /// Dictionary language code; empty or unknown falls back to English.
    pub language: String,
    /// "male", "female" or anything else for a coin flip.
    pub gender: Option<String>,
    /// An [`AGE_RANGES`] value; ignored when `birthdate_options` is set.
    pub age_range: Option<String>,
    pub birthdate_options: Option<BirthdateOptions>,
    /// Optional 32-byte RNG seed as 64 hex characters; the same seed gives the same output.
    pub seed: Option<String>,
}

/// Name and birth date input for username and email prefix generation.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NameInput {
    pub first_name: String,
    pub last_name: String,
    /// Only the leading `yyyy` year is used.
    pub birth_date: String,
    /// Optional 32-byte RNG seed as 64 hex characters; the same seed gives the same output.
    pub seed: Option<String>,
}

/// Generate a random identity from a JSON-serialized [`IdentityRequest`], as JSON.
pub fn generate_identity(request_json: &str) -> Result<String, VaultError> {
    json_call(request_json, |request: IdentityRequest| Ok(generate_from_request(&request)))
}

/// Generate a random identity from a parsed request.
fn generate_from_request(request: &IdentityRequest) -> Identity {
    let mut rng = make_rng(request.seed.as_deref());
    let dictionary = dictionaries::resolve(&request.language);

    let is_male = match request.gender.as_deref() {
        Some("male") => true,
        Some("female") => false,
        _ => unbiased_index(&mut rng, 2) == 0,
    };

    // The birth date comes first: decade-based dictionaries select first names by birth year.
    let birthdate_options = request.birthdate_options.or_else(|| age_range_to_birthdate_options(request.age_range.as_deref().unwrap_or(""), Utc::now().year()));
    let birth_date = random_birth_date(&mut rng, birthdate_options, Utc::now().date_naive());

    let first_names = select_firstnames_for_birth_year(dictionary, birth_date.year(), is_male);
    let last_names = dictionary.lastnames();

    let first_name = first_names[unbiased_index(&mut rng, first_names.len())].to_string();
    let last_name = last_names[unbiased_index(&mut rng, last_names.len())].to_string();
    let birth_year = Some(birth_date.year());

    let email_prefix = username_email::generate_email_prefix(&mut rng, &first_name, &last_name, birth_year);
    let nick_name = username_email::generate_username(&mut rng, &first_name, &last_name, birth_year);

    Identity {
        first_name,
        last_name,
        gender: if is_male { GENDER_MALE } else { GENDER_FEMALE }.to_string(),
        birth_date: birth_date.format("%Y-%m-%d").to_string(),
        email_prefix,
        nick_name,
    }
}

/// Generate a username from a JSON-serialized [`NameInput`].
pub fn generate_username(input_json: &str) -> Result<String, VaultError> {
    let input: NameInput = serde_json::from_str(input_json)?;
    let mut rng = make_rng(input.seed.as_deref());
    Ok(username_email::generate_username(&mut rng, &input.first_name, &input.last_name, parse_birth_year(&input.birth_date)))
}

/// Generate an email prefix from a JSON-serialized [`NameInput`].
pub fn generate_email_prefix(input_json: &str) -> Result<String, VaultError> {
    let input: NameInput = serde_json::from_str(input_json)?;
    let mut rng = make_rng(input.seed.as_deref());
    Ok(username_email::generate_email_prefix(&mut rng, &input.first_name, &input.last_name, parse_birth_year(&input.birth_date)))
}

/// Generate a random alphanumeric email prefix of `length` characters (1 to 64), not based on any identity.
pub fn generate_random_email_prefix(length: u32) -> String {
    let mut rng = make_rng(None);
    username_email::generate_random_string(&mut rng, length.clamp(1, 64) as usize)
}

/// The language codes of the bundled name dictionaries.
pub fn available_languages() -> Vec<String> {
    dictionaries::available_codes().into_iter().map(|c| c.to_string()).collect()
}

/// The age range option values offered by the settings UIs.
pub fn available_age_ranges() -> Vec<String> {
    AGE_RANGES.iter().map(|r| r.to_string()).collect()
}

/// The birth year window of an age range like "21-25" relative to `current_year`; `None` for anything else.
fn age_range_to_birthdate_options(age_range: &str, current_year: i32) -> Option<BirthdateOptions> {
    let (min_part, max_part) = age_range.split_once('-')?;
    let min_age: i32 = min_part.parse().ok()?;
    let max_age: i32 = max_part.parse().ok()?;

    let middle_age = (min_age + max_age).div_euclid(2);
    Some(BirthdateOptions { target_year: current_year - middle_age, year_deviation: (max_age - min_age).div_euclid(2) })
}

/// A random birth date, uniform within the options' year window, or else between 65 and 21 years before `today`.
fn random_birth_date<R: Rng + ?Sized>(rng: &mut R, options: Option<BirthdateOptions>, today: NaiveDate) -> NaiveDate {
    let (start, end) = match options {
        Some(BirthdateOptions { target_year, year_deviation }) => {
            let deviation = year_deviation.saturating_abs();
            (first_day_of_year(target_year.saturating_sub(deviation)), last_day_of_year(target_year.saturating_add(deviation)))
        }
        None => (years_ago(today, DEFAULT_MAX_AGE), years_ago(today, DEFAULT_MIN_AGE)),
    };

    let days = (end - start).num_days().max(0) as usize + 1;
    start.checked_add_days(Days::new(unbiased_index(rng, days) as u64)).unwrap_or(start)
}

/// The first name pool for a birth year: matching decade lists, else all decade names, else the flat per-gender list.
fn select_firstnames_for_birth_year(dictionary: &'static dictionaries::LanguageDictionary, birth_year: i32, is_male: bool) -> Vec<&'static str> {
    let decades = if is_male { dictionary.firstnames_male_by_decade } else { dictionary.firstnames_female_by_decade };

    if !decades.is_empty() {
        let matching: Vec<&'static str> = decades.iter().filter(|d| (d.start_year..=d.end_year).contains(&birth_year)).flat_map(|d| d.names()).collect();
        if !matching.is_empty() {
            return matching;
        }

        let all: Vec<&'static str> = decades.iter().flat_map(|d| d.names()).collect();
        if !all.is_empty() {
            return all;
        }
    }

    if is_male { dictionary.firstnames_male() } else { dictionary.firstnames_female() }
}

/// The leading `yyyy` year of a date string or ISO 8601 timestamp, or `None` when absent.
fn parse_birth_year(birth_date: &str) -> Option<i32> {
    let digits: String = birth_date.trim().chars().take(4).collect();
    if digits.len() == 4 && digits.chars().all(|c| c.is_ascii_digit()) {
        digits.parse().ok()
    } else {
        None
    }
}

/// January 1 of a year.
fn first_day_of_year(year: i32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, 1, 1).unwrap_or(NaiveDate::MIN)
}

/// December 31 of a year.
fn last_day_of_year(year: i32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, 12, 31).unwrap_or(NaiveDate::MAX)
}

/// The same calendar day `years` years before `date` (Feb 29 maps to Feb 28).
fn years_ago(date: NaiveDate, years: i32) -> NaiveDate {
    date.with_year(date.year() - years).unwrap_or_else(|| NaiveDate::from_ymd_opt(date.year() - years, 2, 28).unwrap_or(NaiveDate::MIN))
}
