//! Item deletes in the canonical merge, resolved for the item and all of its child rows together.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};

use super::get_key;
use crate::common::timestamp::updated_at;
use crate::vault_codec::row::{is_deleted, rows_of};
use crate::vault_codec::{is_bucketed_table, CodecRecord};
use crate::vault_model::names::{ID_COL, ITEMS_TABLE};
use crate::vault_model::{MANIFEST_ID_COL, SYNCABLE_TABLES};

type Tables = HashMap<String, Vec<CodecRecord>>;

/*
 * An item is its Items row plus its rows in the child tables (field values, attachments, TOTP codes, passkeys, tags).
 * Merging every row on its own (last write wins) splits that unit when one side deleted the item and the other side
 * kept changing it:
 * - child rows the other side edited after the delete come back, under a deleted item;
 * - when the other side's edit wins the Items row, the child tombstones written at delete time still wipe every child
 *   row that side did not touch.
 * So a delete only one side made is resolved first, for the item as a whole: the delete is compared with the other
 * side's latest change to the item, counting its child rows too (a field edit updates the FieldValues row, not the
 * Items row). When that change is later, the delete loses and the deleting side's Items row and child rows leave the
 * merge. When the delete wins, nothing more is needed: normalizing the merged output drops a deleted item's children.
 */

/// Resolve every item delete only one side made: when the other side changed the item or its child rows later, the
/// deleting side's rows of that item are removed from its input, so the kept item comes through whole.
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
        rows_of(tables, ITEMS_TABLE).iter().filter(|row| is_deleted(row) == deleted).map(|row| (item_key(row, ID_COL), updated_at(row))).collect()
    };
    let tombstones = items(deleting, true);
    let mut live = items(other, false);
    live.retain(|key, _| tombstones.contains_key(key));
    if live.is_empty() {
        return HashSet::new();
    }

    // What the surviving side last did to the item: its own row, or any of its child rows. Bucketed tables stay out,
    // since a usage counter ticking is not an edit.
    for child in SYNCABLE_TABLES.iter().filter(|table| table.item_child && !is_bucketed_table(table.name)) {
        for row in rows_of(other, child.name) {
            if let Some(activity) = live.get_mut(&item_key(row, child.item_ref_column())) {
                *activity = (*activity).max(updated_at(row));
            }
        }
    }

    live.into_iter().filter(|(key, activity)| outlives(tombstones[key], *activity)).map(|(key, _)| key).collect()
}

/// Remove the item rows named by `keys` and all of their child rows.
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
