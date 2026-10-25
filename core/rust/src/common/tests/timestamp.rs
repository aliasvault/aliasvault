use crate::common::timestamp::*;
use chrono::{DateTime, Utc};
use std::collections::HashMap;

#[test]
fn updated_at_parses_both_spellings_a_vault_carries() {
    let at = |value: &str| -> Option<DateTime<Utc>> { updated_at(&HashMap::from([("UpdatedAt".to_string(), serde_json::json!(value))])) };

    assert_eq!(at("2025-12-11T06:50:10.674Z"), at("2025-12-11 06:50:10.674"));
    assert!(at("2025-12-11T06:50:11Z") > at("2025-12-11 06:50:10.674"));
    assert_eq!(at("not a timestamp"), None);
    assert_eq!(updated_at(&HashMap::new()), None);
}

#[test]
fn now_uses_the_vault_and_iso_formats() {
    let stamp = now_vault_datetime();
    assert_eq!(stamp.len(), 23);
    assert_eq!(&stamp[10..11], " ");
    assert!(now_iso_utc().ends_with('Z'));
}
