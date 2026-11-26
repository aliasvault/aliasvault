//! Normalization between the SQLite shape of rows and their codec shape, making sure every writer produces the same manifest
//! for the same data.

mod shape;
mod upgrades;

#[cfg(test)]
mod tests;

use std::collections::HashMap;

use super::manifest::CodecRecord;
use self::shape::{normalize_field_histories, normalize_field_values, normalize_item_tags, restore_stripped_ids};
use self::upgrades::fill_missing_credential_ids;

#[cfg(test)]
pub(crate) use self::shape::{field_history_id_for, field_value_id_for};
pub(crate) use self::shape::{normalize_id_spelling, normalize_row_id_spelling};

type Tables = HashMap<String, Vec<CodecRecord>>;

/// A normalization step over a table set.
type Step = fn(&mut Tables);

/// Permanent: from the SQLite shape to the codec shape.
const TO_CODEC: &[Step] = &[
    normalize_field_values,    // FieldValues: single-value ids stripped and duplicates collapsed, multi-value fields renumbered
    normalize_field_histories, // FieldHistories: ids stripped, same-millisecond snapshots of one field collapsed
    normalize_item_tags,       // ItemTags: surrogate Id dropped, duplicates per (item, tag) collapsed
];

/// Permanent: from the codec shape back to the SQLite shape, in this order.
const TO_SQLITE: &[Step] = &[
    restore_stripped_ids, // FieldValues and FieldHistories: ids the codec shape stripped on purpose to save space, derived again from the natural key
];

/// Temporary: upgrades of rows older clients wrote to the current shape, applied in both directions. Can be deleted later.
const LEGACY_UPGRADES: &[Step] = &[
    fill_missing_credential_ids, // Passkeys: CredentialId from the GUID bytes of Id; remove once clients before 0.32.0 are no longer supported.
];

/// Bring a table set into its codec shape: on canonicalize and on the merge output. The caller repairs referential
/// integrity first.
pub(crate) fn normalize_for_codec(tables: &mut Tables) {
    for step in TO_CODEC.iter().chain(LEGACY_UPGRADES) {
        step(tables);
    }
}

/// Bring a table set from its codec shape into its SQLite shape: on materialize.
pub(crate) fn normalize_for_sqlite(tables: &mut Tables) {
    for step in TO_SQLITE.iter().chain(LEGACY_UPGRADES) {
        step(tables);
    }
}

/// Apply only the legacy upgrades: on bucket rows, which have no shape steps.
pub(crate) fn upgrade_legacy_rows(tables: &mut Tables) {
    for step in LEGACY_UPGRADES {
        step(tables);
    }
}
