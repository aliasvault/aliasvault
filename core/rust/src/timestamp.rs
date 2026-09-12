//! The timestamp formats the vault data model uses.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDateTime, Utc};

/// ISO-8601 UTC with milliseconds (`2026-01-01T00:00:00.000Z`): canonicalized payloads and prune input.
pub const ISO_UTC_MILLIS: &str = "%Y-%m-%dT%H:%M:%S%.3fZ";

/// The vault's row timestamp format (`2026-01-01 00:00:00.000`, UTC).
pub const VAULT_DATETIME: &str = "%Y-%m-%d %H:%M:%S%.3f";

/// Format an instant as ISO-8601 UTC with milliseconds.
pub fn iso_utc(instant: &DateTime<Utc>) -> String {
    instant.format(ISO_UTC_MILLIS).to_string()
}

/// The current instant as ISO-8601 UTC with milliseconds.
pub fn now_iso_utc() -> String {
    iso_utc(&Utc::now())
}

/// The current instant in the vault's row timestamp format.
pub fn now_vault_datetime() -> String {
    Utc::now().format(VAULT_DATETIME).to_string()
}

/// Parse either spelling a vault carries: RFC3339 (`2025-12-11T06:50:10.674Z`, what the codec
/// writes) or the SQLite row form (`2025-12-11 06:50:10.674`, read as UTC).
pub fn parse_vault_datetime(text: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(text)
        .map(|dt| dt.with_timezone(&Utc))
        .ok()
        .or_else(|| NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S%.f").ok().map(|naive| naive.and_utc()))
}

/// A row's `UpdatedAt`, or `None` when absent or unparsable.
pub fn updated_at(row: &HashMap<String, serde_json::Value>) -> Option<DateTime<Utc>> {
    row.get("UpdatedAt").and_then(|v| v.as_str()).and_then(parse_vault_datetime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updated_at_parses_both_spellings_a_vault_carries() {
        let at = |value: &str| -> Option<DateTime<Utc>> { updated_at(&HashMap::from([("UpdatedAt".to_string(), serde_json::json!(value))])) };

        assert_eq!(at("2025-12-11T06:50:10.674Z"), at("2025-12-11 06:50:10.674"));
        assert!(at("2025-12-11T06:50:11Z") > at("2025-12-11 06:50:10.674"));
        assert_eq!(at("not a timestamp"), None);
        assert_eq!(updated_at(&HashMap::new()), None);
    }
}
