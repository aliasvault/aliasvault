//! An in-memory SQLite database that host applications use for uniform access to the vault database.

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

/// The complete client vault schema, generated into `vault_schema.sql`.
pub const VAULT_SCHEMA_SQL: &str = include_str!("vault_schema.sql");

/// One parameterized SQL statement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SqlStatement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
}

/// A typed SQLite value.
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

    /// Run one DML statement with typed parameters and return the number of rows it changed.
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

/// VACUUM when the freelist is large enough to be worth a full rewrite; a no-op inside an open transaction.
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

/// A rusqlite error as a `VaultError`.
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
    let result = statements.iter().try_for_each(|statement| {
        let values = statement.params.iter().map(to_sql).collect::<VaultResult<Vec<RsValue>>>()?;
        conn.execute(&statement.sql, params_from_iter(values.iter())).map(drop).map_err(sql_error_at(&statement.sql))
    });
    if let Err(error) = result {
        let _ = conn.execute_batch("ROLLBACK TO exec_batch; RELEASE exec_batch");
        return Err(error);
    }
    conn.execute_batch("RELEASE exec_batch").map_err(sql_error)
}

#[cfg(test)]
mod tests;
