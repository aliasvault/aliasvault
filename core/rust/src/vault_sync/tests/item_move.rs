//! The schema triggers that carry an item across manifests, run against the real client schema.

use rusqlite::Connection;

use super::test_host::open_schema_db;
use super::{ITEM_A, PERSONAL_MANIFEST_ID, SHARED_MANIFEST_ID};

const T_CREATED: &str = "2024-01-01 00:00:00.000";
const FIELD_VALUE: &str = "eeeeeeee-0000-4000-8000-000000000001";
const TOTP: &str = "44444444-4444-4444-8444-444444444441";

/// A vault holding one personal item with a password and a TOTP code.
fn vault_with_item() -> Connection {
    let db = open_schema_db();
    db.execute("INSERT INTO Items (ManifestId, Id, Name, ItemType, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, 'Bank', 'Login', ?3, ?3, 0)", (PERSONAL_MANIFEST_ID, ITEM_A, T_CREATED)).unwrap();
    db.execute("INSERT INTO FieldValues (ManifestId, Id, ItemId, FieldKey, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, 'login.password', 'secret', 0, 0, ?4, ?4, 0)", (PERSONAL_MANIFEST_ID, FIELD_VALUE, ITEM_A, T_CREATED)).unwrap();
    db.execute("INSERT INTO TotpCodes (ManifestId, Id, ItemId, Name, SecretKey, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, ?3, 'code', 'ABC', ?4, ?4, 0)", (PERSONAL_MANIFEST_ID, TOTP, ITEM_A, T_CREATED)).unwrap();
    db
}

fn move_item(db: &Connection, from: &str, to: &str, at: &str) {
    assert_eq!(db.execute("UPDATE Items SET ManifestId = ?1, UpdatedAt = ?2 WHERE Id = ?3 AND ManifestId = ?4", (to, at, ITEM_A, from)).unwrap(), 1);
}

/// `(IsDeleted, UpdatedAt)` of the item row in `manifest`, when it has one.
fn item_in(db: &Connection, manifest: &str) -> Option<(i64, String)> {
    db.query_row("SELECT IsDeleted, UpdatedAt FROM Items WHERE ManifestId = ?1 AND Id = ?2", (manifest, ITEM_A), |row| Ok((row.get(0)?, row.get(1)?))).ok()
}

fn child_rows_in(db: &Connection, manifest: &str) -> i64 {
    let count = |table: &str| -> i64 { db.query_row(&format!("SELECT COUNT(*) FROM {} WHERE ManifestId = ?1 AND ItemId = ?2", table), (manifest, ITEM_A), |row| row.get(0)).unwrap() };
    count("FieldValues") + count("TotpCodes")
}

#[test]
fn moving_an_item_leaves_a_tombstone_in_the_manifest_it_left_and_can_move_back() {
    // Without the tombstone the merge, a union per manifest, keeps the server's copy in the source manifest and the item ends up in both.
    let db = vault_with_item();
    move_item(&db, PERSONAL_MANIFEST_ID, SHARED_MANIFEST_ID, "2024-02-01 00:00:00.000");

    assert_eq!(item_in(&db, SHARED_MANIFEST_ID), Some((0, "2024-02-01 00:00:00.000".to_string())));
    assert_eq!(child_rows_in(&db, SHARED_MANIFEST_ID), 2, "the item's rows follow it");
    assert_eq!(item_in(&db, PERSONAL_MANIFEST_ID), Some((1, "2024-02-01 00:00:00.000".to_string())), "a tombstone stamped with the move stays behind");
    assert_eq!(child_rows_in(&db, PERSONAL_MANIFEST_ID), 0);

    // The tombstone holds the primary key the item returns to, so the move back clears it first.
    move_item(&db, SHARED_MANIFEST_ID, PERSONAL_MANIFEST_ID, "2024-03-01 00:00:00.000");
    assert_eq!(item_in(&db, PERSONAL_MANIFEST_ID), Some((0, "2024-03-01 00:00:00.000".to_string())));
    assert_eq!(child_rows_in(&db, PERSONAL_MANIFEST_ID), 2);
    assert_eq!(item_in(&db, SHARED_MANIFEST_ID), Some((1, "2024-03-01 00:00:00.000".to_string())), "and the shared manifest now holds the tombstone");
}

#[test]
fn a_live_item_with_the_same_id_in_the_destination_is_never_cleared() {
    // Two manifests holding the same item id is a supported state; only a tombstone gives way to a move.
    let db = vault_with_item();
    db.execute("INSERT INTO Items (ManifestId, Id, Name, ItemType, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, 'Theirs', 'Login', ?3, ?3, 0)", (SHARED_MANIFEST_ID, ITEM_A, T_CREATED)).unwrap();
    let moved = db.execute("UPDATE Items SET ManifestId = ?1 WHERE Id = ?2 AND ManifestId = ?3", (SHARED_MANIFEST_ID, ITEM_A, PERSONAL_MANIFEST_ID));
    assert!(moved.is_err(), "the move is refused rather than overwriting the other item");
    assert_eq!(item_in(&db, SHARED_MANIFEST_ID).map(|(deleted, _)| deleted), Some(0));
}
