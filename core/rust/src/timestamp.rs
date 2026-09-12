//! The timestamp formats the vault data model uses.

use chrono::{DateTime, Utc};

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
