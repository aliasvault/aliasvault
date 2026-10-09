//! An in-memory SQLite database that host applications use for uniform access to the database.
//!
//! The database lives in SQLite's own memory and is never persisted to the filesystem; temporary tables and the
//! scratch copy a VACUUM builds stay in memory too (`temp_store = MEMORY`), so no plaintext page spills to disk.

use std::sync::Mutex;

use rusqlite::types::{ToSql, ToSqlOutput, Value as RsValue, ValueRef};
use rusqlite::{params_from_iter, Connection, MAIN_DB};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::common::encoding::base64_decode;
use crate::common::error::{VaultError, VaultResult};
use crate::vault_codec::row::{inline_b64, inline_bytes};

/// Minimum number of free pages before a VACUUM is worth the full database rewrite on export.
const VACUUM_MIN_FREE_PAGES: i64 = 64;

/// A VACUUM runs when the freelist holds at least this fraction (1/n) of the database's pages.
const VACUUM_FREE_PAGE_RATIO: i64 = 10;

/// The complete client vault schema, generated from `core/vault/src/sql/SqlConstants.ts` by `core/vault/build.sh`.
pub const VAULT_SCHEMA_SQL: &str = include_str!("vault_schema.sql");

/// One parameterized SQL statement, as the bindings and the sync engine hand it to a host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

/// A SQLite value as the bindings see it, typed and without JSON encoding.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum SqlValue {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

/// The rows of one query, positional, with the column names once.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SqlResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<SqlValue>>,
}

/// One in-memory SQLite database.
pub struct MemoryDatabase {
    conn: Mutex<Connection>,
}

impl MemoryDatabase {
    /// Open a database from its file bytes.
    pub fn from_bytes(bytes: &[u8]) -> VaultResult<Self> {
        let mut conn = open_connection()?;
        deserialize_into(&mut conn, bytes)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Open an empty database.
    pub fn empty() -> VaultResult<Self> {
        Ok(Self { conn: Mutex::new(open_connection()?) })
    }

    /// Open an empty database and run a schema script on it.
    pub fn with_schema(schema_sql: &str) -> VaultResult<Self> {
        let conn = open_connection()?;
        conn.execute_batch(schema_sql).map_err(sql_error)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Open an empty database on the latest vault schema, foreign keys off so rows can be inserted in any order.
    pub fn with_latest_schema() -> VaultResult<Self> {
        let db = Self::with_schema(VAULT_SCHEMA_SQL)?;
        db.execute_batch("PRAGMA foreign_keys = OFF")?;
        Ok(db)
    }

    /// Run a SQL script (several statements, no parameters).
    pub fn execute_batch(&self, sql: &str) -> VaultResult<()> {
        self.lock().execute_batch(sql).map_err(sql_error)
    }

    /// Run one query and return its rows as JSON objects keyed by column name.
    pub fn query(&self, sql: &str, params: &[Value]) -> VaultResult<Vec<Map<String, Value>>> {
        query(&self.lock(), sql, params)
    }

    /// Run statements in one transaction; any failure rolls all of them back.
    pub fn exec(&self, statements: &[SqlStatement]) -> VaultResult<()> {
        exec(&self.lock(), statements)
    }

    /// Run one query with typed parameters and return its rows positionally.
    pub fn query_values(&self, sql: &str, params: &[SqlValue]) -> VaultResult<SqlResult> {
        let conn = self.lock();
        let mut statement = conn.prepare_cached(sql).map_err(sql_error_at(sql))?;
        let columns: Vec<String> = statement.column_names().iter().map(|c| c.to_string()).collect();
        let mut rows = statement.query(params_from_iter(params.iter())).map_err(sql_error_at(sql))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(sql_error)? {
            let mut values = Vec::with_capacity(columns.len());
            for index in 0..columns.len() {
                values.push(SqlValue::from(row.get_ref(index).map_err(sql_error)?));
            }
            out.push(values);
        }
        Ok(SqlResult { columns, rows: out })
    }

    /// Run one DML statement with typed parameters and return the rows it changed (stale for a SELECT, which changes nothing).
    pub fn execute(&self, sql: &str, params: &[SqlValue]) -> VaultResult<u64> {
        let conn = self.lock();
        let mut statement = conn.prepare_cached(sql).map_err(sql_error_at(sql))?;
        let mut rows = statement.query(params_from_iter(params.iter())).map_err(sql_error_at(sql))?;
        while rows.next().map_err(sql_error)?.is_some() {}
        Ok(conn.changes())
    }

    /// The database as SQLite file bytes, compacted first when it is fragmented and no transaction is open.
    pub fn export(&self) -> VaultResult<Vec<u8>> {
        let conn = self.lock();
        vacuum_if_fragmented(&conn)?;
        Ok(conn.serialize(MAIN_DB).map_err(sql_error)?.to_vec())
    }

    /// Run `f` on the connection, holding the lock for the whole call.
    pub fn with_connection<R>(&self, f: impl FnOnce(&Connection) -> VaultResult<R>) -> VaultResult<R> {
        f(&self.lock())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// An in-memory connection.
fn open_connection() -> VaultResult<Connection> {
    let conn = Connection::open_in_memory().map_err(sql_error)?;
    conn.pragma_update(None, "temp_store", "MEMORY").map_err(sql_error)?;
    Ok(conn)
}

/// Rebuild the database to reclaim free pages if there are enough free pages to make it worth it.
fn vacuum_if_fragmented(conn: &Connection) -> VaultResult<()> {
    if !conn.is_autocommit() {
        return Ok(());
    }
    let free_pages: i64 = conn.pragma_query_value(None, "freelist_count", |row| row.get(0)).map_err(sql_error)?;
    let total_pages: i64 = conn.pragma_query_value(None, "page_count", |row| row.get(0)).map_err(sql_error)?;
    if free_pages >= VACUUM_MIN_FREE_PAGES && free_pages * VACUUM_FREE_PAGE_RATIO >= total_pages {
        conn.execute_batch("VACUUM").map_err(sql_error)?;
    }
    Ok(())
}

/// Load SQLite file bytes into a connection's main database, held in SQLite-owned memory.
pub fn deserialize_into(conn: &mut Connection, bytes: &[u8]) -> VaultResult<()> {
    if bytes.is_empty() {
        return Err(VaultError::General("Cannot open a SQLite database from zero bytes".to_string()));
    }
    conn.deserialize_read_exact(MAIN_DB, bytes, bytes.len(), false).map_err(sql_error)
}

pub(crate) fn sql_error(error: rusqlite::Error) -> VaultError {
    VaultError::General(error.to_string())
}

/// The error mapper for a failure inside `sql`, naming the statement.
fn sql_error_at(sql: &str) -> impl Fn(rusqlite::Error) -> VaultError + '_ {
    move |error| VaultError::General(format!("{} ({})", error, sql))
}

impl ToSql for SqlValue {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            SqlValue::Null => ToSqlOutput::Borrowed(ValueRef::Null),
            SqlValue::Integer(i) => ToSqlOutput::Borrowed(ValueRef::Integer(*i)),
            SqlValue::Real(f) => ToSqlOutput::Borrowed(ValueRef::Real(*f)),
            SqlValue::Text(t) => ToSqlOutput::Borrowed(ValueRef::Text(t.as_bytes())),
            SqlValue::Blob(b) => ToSqlOutput::Borrowed(ValueRef::Blob(b)),
        })
    }
}

impl From<ValueRef<'_>> for SqlValue {
    fn from(value: ValueRef<'_>) -> Self {
        match value {
            ValueRef::Null => SqlValue::Null,
            ValueRef::Integer(i) => SqlValue::Integer(i),
            ValueRef::Real(f) => SqlValue::Real(f),
            ValueRef::Text(t) => SqlValue::Text(String::from_utf8_lossy(t).to_string()),
            ValueRef::Blob(b) => SqlValue::Blob(b.to_vec()),
        }
    }
}

/// A JSON parameter as a SQLite value. A `{ __b64 }` cell that is not valid base64 is an error, never an empty BLOB.
fn to_sql(value: &Value) -> VaultResult<RsValue> {
    Ok(match value {
        Value::Null => RsValue::Null,
        Value::Bool(b) => RsValue::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map_or_else(|| n.as_f64().map_or(RsValue::Null, RsValue::Real), RsValue::Integer),
        Value::String(s) => RsValue::Text(s.clone()),
        other => match inline_b64(other) {
            Some(b64) => RsValue::Blob(base64_decode(b64).map_err(|_| VaultError::General("A BLOB parameter is not valid base64".to_string()))?),
            None => RsValue::Text(other.to_string()),
        },
    })
}

/// A SQLite value as JSON.
fn from_sql(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(b) => inline_bytes(b),
    }
}

/// Run one query on a connection and return its rows as JSON objects keyed by column name.
pub fn query(conn: &Connection, sql: &str, params: &[Value]) -> VaultResult<Vec<Map<String, Value>>> {
    let mut statement = conn.prepare(sql).map_err(sql_error_at(sql))?;
    let columns: Vec<String> = statement.column_names().iter().map(|c| c.to_string()).collect();
    let values: Vec<RsValue> = params.iter().map(to_sql).collect::<VaultResult<_>>()?;
    let mut rows = statement.query(params_from_iter(values.iter())).map_err(sql_error_at(sql))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(sql_error)? {
        let mut object = Map::new();
        for (index, column) in columns.iter().enumerate() {
            object.insert(column.clone(), from_sql(row.get_ref(index).map_err(sql_error)?));
        }
        out.push(object);
    }
    Ok(out)
}

/// Run statements on a connection atomically.
pub fn exec(conn: &Connection, statements: &[SqlStatement]) -> VaultResult<()> {
    conn.execute_batch("SAVEPOINT exec_batch").map_err(sql_error)?;
    for statement in statements {
        let values = match statement.params.iter().map(to_sql).collect::<VaultResult<Vec<RsValue>>>() {
            Ok(values) => values,
            Err(error) => {
                let _ = conn.execute_batch("ROLLBACK TO exec_batch; RELEASE exec_batch");
                return Err(error);
            }
        };
        if let Err(error) = conn.execute(&statement.sql, params_from_iter(values.iter())) {
            let _ = conn.execute_batch("ROLLBACK TO exec_batch; RELEASE exec_batch");
            return Err(sql_error_at(&statement.sql)(error));
        }
    }
    conn.execute_batch("RELEASE exec_batch").map_err(sql_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::encoding::base64_encode;

    fn adversarial() -> Vec<Vec<u8>> {
        let mut large = vec![0u8; 1024 * 1024];
        crate::common::rng::fill_random(&mut large);
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
}
