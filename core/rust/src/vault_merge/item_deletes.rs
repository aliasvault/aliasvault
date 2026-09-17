//! Item deletes in the canonical merge, decided once per item instead of row by row.
//!
//! A permanent delete tombstones the item and takes the rows hanging off it along, so the item and
//! its children are one unit. Row-level LWW breaks that unit both ways: children the deleting side
//! removed come back from the other side under a tombstoned item, and child tombstones stamped at
//! delete time wipe the untouched fields of an item whose delete lost. So a delete only one side made
//! is settled here first, against everything the other side did to that item (a field edit does not
//! touch the item row), and the losing side's rows of the item leave the merge. A delete that stands
//! needs nothing more: the merged output drops a tombstoned item's children when it is normalized.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};

use super::get_key;
use crate::timestamp::updated_at;
use crate::vault_codec::row::is_deleted;
use crate::vault_codec::{is_bucketed_table, CodecRecord};
use crate::vault_model::names::{ID_COL, ITEMS_TABLE};
use crate::vault_model::{MANIFEST_ID_COL, SYNCABLE_TABLES};

type Tables = HashMap<String, Vec<CodecRecord>>;

/// Settle every delete only one side made: a delete the other side outlived is taken out of the deleting
/// side's input together with that side's rows of the item, so the surviving side's rows pass through whole.
pub(super) fn resolve_item_deletes(base: &mut Tables, incoming: &mut Tables) {
    // The base keeps ties, exactly as it does for a single row.
    let lost_in_base = lost_deletes(base, incoming, |delete, activity| activity > delete);
    let lost_in_incoming = lost_deletes(incoming, base, |delete, activity| activity >= delete);
    remove_items(base, &lost_in_base);
    remove_items(incoming, &lost_in_incoming);
}

/// The items `deleting` tombstoned that `other` still holds live and touched late enough for `outlives` to hold.
fn lost_deletes(deleting: &Tables, other: &Tables, outlives: impl Fn(Option<DateTime<Utc>>, Option<DateTime<Utc>>) -> bool) -> HashSet<String> {
    let items = |tables: &Tables, deleted: bool| -> HashMap<String, Option<DateTime<Utc>>> {
        let rows = tables.get(ITEMS_TABLE).map(Vec::as_slice).unwrap_or(&[]);
        rows.iter().filter(|row| is_deleted(row) == deleted).map(|row| (item_key(row, ID_COL), updated_at(row))).collect()
    };
    let tombstones = items(deleting, true);
    let mut live = items(other, false);
    live.retain(|key, _| tombstones.contains_key(key));
    if live.is_empty() {
        return HashSet::new();
    }

    // What the surviving side last did to the item: its own row, or any row hanging off it. Bucketed
    // tables stay out, since a usage counter ticking is not an edit.
    for child in SYNCABLE_TABLES.iter().filter(|table| table.item_child && !is_bucketed_table(table.name)) {
        for row in other.get(child.name).map(Vec::as_slice).unwrap_or(&[]) {
            if let Some(activity) = live.get_mut(&item_key(row, child.item_ref_column())) {
                *activity = (*activity).max(updated_at(row));
            }
        }
    }

    live.into_iter().filter(|(key, activity)| outlives(tombstones[key], *activity)).map(|(key, _)| key).collect()
}

/// Remove the item rows named by `keys` and every row hanging off them.
fn remove_items(tables: &mut Tables, keys: &HashSet<String>) {
    if keys.is_empty() {
        return;
    }
    if let Some(rows) = tables.get_mut(ITEMS_TABLE) {
        rows.retain(|row| !keys.contains(&item_key(row, ID_COL)));
    }
    for child in SYNCABLE_TABLES.iter().filter(|table| table.item_child) {
        if let Some(rows) = tables.get_mut(child.name) {
            rows.retain(|row| !keys.contains(&item_key(row, child.item_ref_column())));
        }
    }
}

/// The `(ManifestId, item id)` key of an item row, or of a child row through `item_column`.
fn item_key(row: &CodecRecord, item_column: &str) -> String {
    get_key(row, &[MANIFEST_ID_COL, item_column])
}
