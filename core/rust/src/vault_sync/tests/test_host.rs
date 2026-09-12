//! A reference host for the engine tests: real SQLite (rusqlite), in-memory state, scripted HTTP.

use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection, DatabaseName};
use serde_json::{json, Map, Value};

use crate::crypto;
use crate::vault_sync::types::{Command, Db, SqlStatement};
use crate::vault_sync::session::SyncSession;

/// One recorded HTTP request.
#[derive(Debug, Clone)]
pub struct RecordedRequest {
    pub method: String,
    pub path: String,
    pub body: Option<Value>,
}

/// A scripted HTTP answer: status and JSON body for a (method, path) match.
pub type Responder = Box<dyn Fn(&str, &str, Option<&Value>) -> Option<(u16, Value)>>;

pub struct TestHost {
    pub local: Connection,
    pub staging: Option<Connection>,
    pub state: HashMap<String, Value>,
    pub vault_blob: Option<String>,
    pub vault_key: String,
    pub mutation_sequence: u64,
    pub is_dirty: bool,
    pub mark_clean_calls: Vec<u64>,
    pub store_calls: Vec<Command>,
    pub requests: Vec<RecordedRequest>,
    pub responders: Vec<Responder>,
    pub logs: Vec<String>,
    pub schema_sql: String,
}

/// The current client schema, read from the TypeScript source of truth.
pub fn complete_schema_sql() -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../vault/src/sql/SqlConstants.ts");
    let source = std::fs::read_to_string(path).expect("core/vault/src/sql/SqlConstants.ts");
    let start = source.find("COMPLETE_SCHEMA_SQL = `").expect("COMPLETE_SCHEMA_SQL") + "COMPLETE_SCHEMA_SQL = `".len();
    let end = source[start..].find("`;").expect("end of template literal") + start;
    source[start..end].replace('\u{feff}', "")
}

/// Open a database from its file bytes (through a scratch file, since rusqlite's deserialize wants sqlite-owned memory).
pub fn open_from_bytes(bytes: &[u8]) -> Connection {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let unique = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let path = std::env::temp_dir().join(format!("aliasvault-sync-test-{}-{}.sqlite", std::process::id(), unique));
    std::fs::write(&path, bytes).unwrap();
    let file = Connection::open(&path).unwrap();
    let mut conn = Connection::open_in_memory().unwrap();
    {
        let backup = rusqlite::backup::Backup::new(&file, &mut conn).unwrap();
        backup.run_to_completion(5, std::time::Duration::from_millis(1), None).unwrap();
    }
    drop(file);
    let _ = std::fs::remove_file(&path);
    conn
}

pub fn open_schema_db(schema_sql: &str) -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
    conn.execute_batch(schema_sql).unwrap();
    conn
}

impl TestHost {
    pub fn new(vault_key: &str) -> Self {
        let schema_sql = complete_schema_sql();
        Self {
            local: open_schema_db(&schema_sql),
            staging: None,
            state: HashMap::new(),
            vault_blob: None,
            vault_key: vault_key.to_string(),
            mutation_sequence: 0,
            is_dirty: false,
            mark_clean_calls: Vec::new(),
            store_calls: Vec::new(),
            requests: Vec::new(),
            responders: Vec::new(),
            logs: Vec::new(),
            schema_sql,
        }
    }

    /// Answer requests whose method and path match.
    pub fn respond(&mut self, method: &'static str, path: &'static str, body: Value) {
        self.responders.push(Box::new(move |m, p, _| if m == method && p == path { Some((200, body.clone())) } else { None }));
    }

    pub fn respond_with(&mut self, responder: Responder) {
        self.responders.push(responder);
    }

    /// Encrypt the local database as the at-rest blob, the way the app stores it.
    pub fn store_local_as_blob(&mut self) {
        let bytes = self.local.serialize(DatabaseName::Main).unwrap().to_vec();
        self.vault_blob = Some(crypto::symmetric_encrypt_bytes(&bytes, &self.vault_key).unwrap());
    }

    /// Drive a session to completion and return the `done` result.
    pub fn drive(&mut self, session: &SyncSession) -> Value {
        loop {
            let command: Command = serde_json::from_str(&session.next_command().unwrap()).unwrap();
            let response = match command {
                Command::Done { result } => return result,
                Command::Http { method, path, body, .. } => {
                    let body_json = body.as_deref().map(|b| serde_json::from_str(b).unwrap_or(Value::String(b.to_string())));
                    let method = serde_json::to_value(method).unwrap().as_str().expect("http method serializes as text").to_string();
                    self.requests.push(RecordedRequest { method: method.clone(), path: path.clone(), body: body_json.clone() });
                    match self.responders.iter().find_map(|r| r(&method, &path, body_json.as_ref())) {
                        Some((status, body)) => json!({ "status": status, "body": body.to_string() }),
                        None => json!({ "status": 0, "transportError": format!("no scripted response for {} {}", method, path) }),
                    }
                }
                Command::StateGet { key } => json!({ "value": self.state.get(&key).cloned().unwrap_or(Value::Null) }),
                Command::StateSet { key, value } => {
                    self.state.insert(key, value);
                    json!({})
                }
                Command::StateRemove { key } => {
                    self.state.remove(&key);
                    json!({})
                }
                Command::DbOpen { bytes, .. } => {
                    self.staging = Some(match bytes {
                        None => open_schema_db(&self.schema_sql),
                        Some(b64) => {
                            let conn = open_from_bytes(&BASE64.decode(b64).unwrap());
                            conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
                            conn
                        }
                    });
                    json!({})
                }
                Command::DbQuery { db, .. } | Command::DbExec { db, .. } | Command::DbExport { db } if db == Db::Local && self.vault_blob.is_none() => {
                    // Like the app hosts: without a stored vault there is no local database to open.
                    json!({ "error": "Vault not available" })
                }
                Command::DbQuery { db, sql, params } => match query(self.db(db), &sql, &params) {
                    Ok(rows) => json!({ "rows": rows }),
                    Err(error) => json!({ "error": format!("{} ({})", error, sql) }),
                },
                Command::DbExec { db, statements } => match exec(self.db(db), &statements) {
                    Ok(()) => json!({}),
                    Err(error) => json!({ "error": error }),
                },
                Command::DbExport { db } => json!({ "bytes": BASE64.encode(self.db(db).serialize(DatabaseName::Main).unwrap().to_vec()) }),
                Command::VaultStore { encrypted_blob, mark_dirty, encryption_key, expected_mutation_seq, revision } => {
                    self.store_calls.push(Command::VaultStore { encrypted_blob: String::new(), mark_dirty, encryption_key: encryption_key.clone(), expected_mutation_seq, revision });
                    if let Some(key) = encryption_key {
                        self.vault_key = key;
                    }
                    if let Some(expected) = expected_mutation_seq {
                        if expected != self.mutation_sequence {
                            json!({ "success": false, "mutationSequence": self.mutation_sequence })
                        } else {
                            self.adopt_blob(&encrypted_blob);
                            json!({ "success": true, "mutationSequence": self.mutation_sequence })
                        }
                    } else {
                        if mark_dirty {
                            self.mutation_sequence += 1;
                            self.is_dirty = true;
                        }
                        self.adopt_blob(&encrypted_blob);
                        json!({ "success": true, "mutationSequence": self.mutation_sequence })
                    }
                }
                Command::VaultLoad => json!({ "encryptedBlob": self.vault_blob.clone() }),
                Command::MarkClean { mutation_seq_at_start } => {
                    self.mark_clean_calls.push(mutation_seq_at_start);
                    let cleared = mutation_seq_at_start == self.mutation_sequence;
                    if cleared {
                        self.is_dirty = false;
                    }
                    json!({ "cleared": cleared })
                }
                Command::Log { level, message } => {
                    self.logs.push(format!("[{:?}] {}", level, message));
                    json!({})
                }
            };
            session.resume(&response.to_string()).unwrap();
        }
    }

    /// Store a blob and reload `local` from it, as the contract requires.
    fn adopt_blob(&mut self, encrypted_blob: &str) {
        self.vault_blob = Some(encrypted_blob.to_string());
        let bytes = crypto::symmetric_decrypt_bytes(&BASE64.decode(encrypted_blob).unwrap(), &self.vault_key).expect("stored blob decrypts with the vault key");
        self.local = open_from_bytes(&bytes);
    }

    fn db(&mut self, db: Db) -> &Connection {
        match db {
            Db::Local => &self.local,
            Db::Staging => self.staging.as_ref().expect("staging database opened"),
        }
    }

    pub fn requests_to(&self, path: &str) -> Vec<&RecordedRequest> {
        self.requests.iter().filter(|r| r.path == path).collect()
    }
}

fn to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(SqlValue::Integer).unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Object(o) if o.contains_key("__b64") => SqlValue::Blob(BASE64.decode(o["__b64"].as_str().unwrap_or("")).unwrap_or_default()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn from_sql(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(b) => json!({ "__b64": BASE64.encode(b) }),
    }
}

pub fn query(conn: &Connection, sql: &str, params: &[Value]) -> Result<Vec<Map<String, Value>>, String> {
    let mut statement = conn.prepare(sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = statement.column_names().iter().map(|c| c.to_string()).collect();
    let values: Vec<SqlValue> = params.iter().map(to_sql).collect();
    let mut rows = statement.query(params_from_iter(values.iter())).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut object = Map::new();
        for (index, column) in columns.iter().enumerate() {
            object.insert(column.clone(), from_sql(row.get_ref(index).map_err(|e| e.to_string())?));
        }
        out.push(object);
    }
    Ok(out)
}

pub fn exec(conn: &Connection, statements: &[SqlStatement]) -> Result<(), String> {
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    for statement in statements {
        let values: Vec<SqlValue> = statement.params.iter().map(to_sql).collect();
        if let Err(error) = conn.execute(&statement.sql, params_from_iter(values.iter())) {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(format!("{} ({})", error, statement.sql));
        }
    }
    conn.execute_batch("COMMIT").map_err(|e| e.to_string())
}
