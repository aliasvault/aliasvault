use crate::common::secret::*;
use secrecy::SecretString;
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
