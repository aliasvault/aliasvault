use crate::sqlite_host::*;
use crate::common::encoding::base64_encode;

fn adversarial() -> Vec<Vec<u8>> {
    let large = crate::common::rng::random_bytes(1024 * 1024);
    vec![vec![], vec![0x00], vec![0xFF], vec![0x00, 0xFF], vec![0xC3, 0x28, 0xA0], vec![0xED, 0xA0, 0x80, 0xF8], b"QUJD".to_vec(), (0u8..=255).collect(), large]
}

#[test]
fn blob_cells_round_trip_through_json_and_typed_values() {
    let db = MemoryDatabase::with_schema("CREATE TABLE T (Id INTEGER, Data BLOB);").unwrap();
    for (id, bytes) in adversarial().iter().enumerate() {
        db.exec(&[SqlStatement { sql: "INSERT INTO T (Id, Data) VALUES (?, ?)".to_string(), params: vec![json!(id), inline_bytes(bytes)] }]).unwrap();
        let rows = db.query("SELECT typeof(Data) AS Kind, Data FROM T WHERE Id = ?", &[json!(id)]).unwrap();
        assert_eq!(rows[0]["Kind"], "blob", "{} bytes", bytes.len());
        assert_eq!(rows[0]["Data"], json!({ "__b64": base64_encode(bytes) }), "{} bytes", bytes.len());
        let typed = db.query_values("SELECT Data FROM T WHERE Id = ?", &[SqlValue::Integer(id as i64)]).unwrap();
        assert_eq!(typed.rows[0][0], SqlValue::Blob(bytes.clone()));
        db.execute("UPDATE T SET Data = ? WHERE Id = ?", &[SqlValue::Blob(bytes.clone()), SqlValue::Integer(id as i64)]).unwrap();
        assert_eq!(db.export().map(|exported| MemoryDatabase::from_bytes(&exported).unwrap().query_values("SELECT Data FROM T WHERE Id = ?", &[SqlValue::Integer(id as i64)]).unwrap().rows[0][0].clone()).unwrap(), SqlValue::Blob(bytes.clone()));
    }
}

#[test]
fn temporary_storage_stays_in_memory() {
    let db = MemoryDatabase::empty().unwrap();
    assert_eq!(db.query("PRAGMA temp_store", &[]).unwrap()[0]["temp_store"], json!(2));
    let reopened = MemoryDatabase::from_bytes(&db.export().unwrap()).unwrap();
    assert_eq!(reopened.query("PRAGMA temp_store", &[]).unwrap()[0]["temp_store"], json!(2));
}

#[test]
fn foreign_keys_are_on_by_default() {
    let db = MemoryDatabase::empty().unwrap();
    assert_eq!(db.query("PRAGMA foreign_keys", &[]).unwrap()[0]["foreign_keys"], json!(1), "the hosts rely on the bundled SQLite default");
}

#[test]
fn export_compacts_only_a_fragmented_database_outside_a_transaction() {
    let page_count = |db: &MemoryDatabase| db.query("PRAGMA page_count", &[]).unwrap()[0]["page_count"].as_i64().unwrap();
    let free_pages = |db: &MemoryDatabase| db.query("PRAGMA freelist_count", &[]).unwrap()[0]["freelist_count"].as_i64().unwrap();
    let db = MemoryDatabase::with_schema("CREATE TABLE T (Id INTEGER, Data BLOB);").unwrap();
    for id in 0..200 {
        db.execute("INSERT INTO T (Id, Data) VALUES (?, ?)", &[SqlValue::Integer(id), SqlValue::Blob(vec![7u8; 4096])]).unwrap();
    }

    db.execute("DELETE FROM T WHERE Id < 5", &[]).unwrap();
    let slightly_fragmented = free_pages(&db);
    assert!(slightly_fragmented > 0 && slightly_fragmented < VACUUM_MIN_FREE_PAGES);
    db.export().unwrap();
    assert_eq!(free_pages(&db), slightly_fragmented, "a few free pages are not worth a rewrite");

    db.execute_batch("BEGIN; DELETE FROM T WHERE Id < 150;").unwrap();
    db.export().unwrap();
    assert!(free_pages(&db) >= VACUUM_MIN_FREE_PAGES, "no VACUUM inside an open transaction");
    db.execute_batch("COMMIT").unwrap();

    let before = page_count(&db);
    let exported = db.export().unwrap();
    assert_eq!(free_pages(&db), 0);
    assert!(page_count(&db) < before);
    let reopened = MemoryDatabase::from_bytes(&exported).unwrap();
    assert_eq!(reopened.query("SELECT COUNT(*) AS N FROM T", &[]).unwrap()[0]["N"], json!(50));
    assert_eq!(free_pages(&reopened), 0);
}

#[test]
fn invalid_base64_blob_parameter_fails_instead_of_binding_empty_bytes() {
    let db = MemoryDatabase::with_schema("CREATE TABLE T (Data BLOB);").unwrap();
    let statements = [
        SqlStatement { sql: "INSERT INTO T (Data) VALUES (?)".to_string(), params: vec![inline_bytes(&[1, 2, 3])] },
        SqlStatement { sql: "INSERT INTO T (Data) VALUES (?)".to_string(), params: vec![json!({ "__b64": "not base64!" })] },
    ];
    assert!(db.exec(&statements).is_err());
    assert!(db.query("SELECT * FROM T", &[]).unwrap().is_empty(), "the whole batch rolls back");
    assert!(db.query("SELECT * FROM T WHERE Data = ?", &[json!({ "__b64": "A" })]).is_err(), "a truncated parameter is refused, not read as empty");
}
