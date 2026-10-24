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

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Serialize, Deserialize)]
    struct Holder {
        #[serde(serialize_with = "serialize_option")]
        key: Option<SecretString>,
    }

    #[test]
    fn round_trips_as_a_plain_string_and_never_prints() {
        let holder: Holder = serde_json::from_str(r#"{"key":"k"}"#).unwrap();
        assert_eq!(serde_json::to_string(&holder).unwrap(), r#"{"key":"k"}"#);
        assert!(format!("{:?}", holder).contains("[REDACTED]"));
    }
}
