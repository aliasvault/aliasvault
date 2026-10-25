//! Helpers for `SecretString`: moving key text in, and writing it back out over the JSON boundary.

use secrecy::{ExposeSecret, SecretString};
use serde::Serializer;
use zeroize::Zeroizing;

/// Moves a zeroizing string into a `SecretString`.
pub fn from_zeroizing(value: Zeroizing<String>) -> SecretString {
    SecretString::from(value.as_str())
}

/// Writes an optional secret as a plain JSON string, for `#[serde(serialize_with = ...)]`.
pub fn serialize_option<S: Serializer>(value: &Option<SecretString>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(secret) => serializer.serialize_some(secret.expose_secret()),
        None => serializer.serialize_none(),
    }
}
