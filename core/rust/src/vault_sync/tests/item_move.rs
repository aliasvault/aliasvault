//! The schema triggers that carry an item across manifests, run against the real client schema.

use rusqlite::Connection;

use super::test_host::{complete_schema_sql, open_schema_db};

const PERSONAL: &str = "11111111-1111-4111-8111-111111111111";
const SHARED: &str = "22222222-2222-4222-8222-222222222222";
const ITEM: &str = "33333333-3333-4333-8333-333333333333";
const T_CREATED: &str = "2024-01-01 00:00:00.000";

/// A vault holding one personal item with a password and a TOTP code.
fn vault_with_item() -> Connection {
    let db = open_schema_db(&complete_schema_sql());
    db.execute("INSERT INTO Items (ManifestId, Id, Name, ItemType, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, 'Bank', 'Login', ?3, ?3, 0)", (PERSONAL, ITEM, T_CREATED)).unwrap();
    db.execute("INSERT INTO FieldValues (ManifestId, Id, ItemId, FieldKey, Value, Weight, ValueIndex, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, 'fv-1', ?2, 'login.password', 'secret', 0, 0, ?3, ?3, 0)", (PERSONAL, ITEM, T_CREATED)).unwrap();
    db.execute("INSERT INTO TotpCodes (ManifestId, Id, ItemId, Name, SecretKey, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, 'totp-1', ?2, 'code', 'ABC', ?3, ?3, 0)", (PERSONAL, ITEM, T_CREATED)).unwrap();
    db
}

fn move_item(db: &Connection, from: &str, to: &str, at: &str) {
    assert_eq!(db.execute("UPDATE Items SET ManifestId = ?1, UpdatedAt = ?2 WHERE Id = ?3 AND ManifestId = ?4", (to, at, ITEM, from)).unwrap(), 1);
}

/// `(IsDeleted, UpdatedAt)` of the item row in `manifest`, when it has one.
fn item_in(db: &Connection, manifest: &str) -> Option<(i64, String)> {
    db.query_row("SELECT IsDeleted, UpdatedAt FROM Items WHERE ManifestId = ?1 AND Id = ?2", (manifest, ITEM), |row| Ok((row.get(0)?, row.get(1)?))).ok()
}

fn child_rows_in(db: &Connection, manifest: &str) -> i64 {
    let count = |table: &str| -> i64 { db.query_row(&format!("SELECT COUNT(*) FROM {} WHERE ManifestId = ?1 AND ItemId = ?2", table), (manifest, ITEM), |row| row.get(0)).unwrap() };
    count("FieldValues") + count("TotpCodes")
}

#[test]
fn moving_an_item_leaves_a_tombstone_in_the_manifest_it_left() {
    // Without it the merge, a union per manifest, keeps the server's copy in the source manifest and the item ends up in both.
    let db = vault_with_item();
    move_item(&db, PERSONAL, SHARED, "2024-02-01 00:00:00.000");

    assert_eq!(item_in(&db, SHARED), Some((0, "2024-02-01 00:00:00.000".to_string())));
    assert_eq!(child_rows_in(&db, SHARED), 2, "the item's rows follow it");
    assert_eq!(item_in(&db, PERSONAL), Some((1, "2024-02-01 00:00:00.000".to_string())), "a tombstone stamped with the move stays behind");
    assert_eq!(child_rows_in(&db, PERSONAL), 0);
}

#[test]
fn an_item_can_move_back_into_the_manifest_it_left() {
    // The tombstone holds the primary key the item returns to, so the move back clears it first.
    let db = vault_with_item();
    move_item(&db, PERSONAL, SHARED, "2024-02-01 00:00:00.000");
    move_item(&db, SHARED, PERSONAL, "2024-03-01 00:00:00.000");

    assert_eq!(item_in(&db, PERSONAL), Some((0, "2024-03-01 00:00:00.000".to_string())));
    assert_eq!(child_rows_in(&db, PERSONAL), 2);
    assert_eq!(item_in(&db, SHARED), Some((1, "2024-03-01 00:00:00.000".to_string())), "and the shared manifest now holds the tombstone");
}

#[test]
fn a_live_item_with_the_same_id_in_the_destination_is_never_cleared() {
    // Two manifests holding the same item id is a supported state; only a tombstone gives way to a move.
    let db = vault_with_item();
    db.execute("INSERT INTO Items (ManifestId, Id, Name, ItemType, CreatedAt, UpdatedAt, IsDeleted) VALUES (?1, ?2, 'Theirs', 'Login', ?3, ?3, 0)", (SHARED, ITEM, T_CREATED)).unwrap();
    let moved = db.execute("UPDATE Items SET ManifestId = ?1 WHERE Id = ?2 AND ManifestId = ?3", (SHARED, ITEM, PERSONAL));
    assert!(moved.is_err(), "the move is refused rather than overwriting the other item");
    assert_eq!(item_in(&db, SHARED).map(|(deleted, _)| deleted), Some(0));
}
