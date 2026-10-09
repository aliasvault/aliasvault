//! A reference host for the engine tests: one device with real SQLite (rusqlite), in-memory state and HTTP
//! answered by a [`FakeServer`](super::fake_server::FakeServer) or a scripted responder.

use std::collections::HashMap;

use rusqlite::{Connection, MAIN_DB};
use serde_json::{json, Map, Value};

use super::fake_server::Server;
use crate::crypto;
use crate::sqlite_host::{self, SqlStatement};
use crate::vault_codec::{self, CodecTableData};
use crate::vault_sync::session::SyncSession;
use crate::vault_sync::state;
use crate::vault_sync::types::{Command, Db};

pub const USERNAME: &str = "tester";

/// One recorded HTTP request.
#[derive(Debug, Clone)]
pub struct RecordedRequest {
    pub method: String,
    pub path: String,
    pub body: Option<Value>,
}

/// A scripted HTTP answer: status and JSON body for a (method, path) match, `None` to pass.
pub type Responder = Box<dyn Fn(&str, &str, Option<&Value>) -> Option<(u16, Value)>>;

pub struct TestHost {
    pub local: Connection,
    pub staging: Option<Connection>,
    pub state: HashMap<String, Value>,
    pub vault_blob: Option<String>,
    /// The key the stored vault is encrypted under; the session key `sync` and `run` hand to the engine.
    pub vault_key: String,
    pub mutation_sequence: u64,
    pub is_dirty: bool,
    pub mark_clean_calls: Vec<u64>,
    pub store_calls: Vec<Command>,
    /// Stores under a new key; the host asserts each one found the key chain cached first.
    pub rekeyed_stores: usize,
    pub requests: Vec<RecordedRequest>,
    pub responders: Vec<Responder>,
    pub logs: Vec<String>,
}

/// The current client schema.
pub fn complete_schema_sql() -> String {
    sqlite_host::VAULT_SCHEMA_SQL.to_string()
}

/// Open a database from its file bytes, in memory.
pub fn open_from_bytes(bytes: &[u8]) -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    sqlite_host::deserialize_into(&mut conn, bytes).unwrap();
    // Foreign keys off, like the app hosts, so a test can write the stray rows real clients produce.
    conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
    conn
}

/// A fresh database on the client schema, foreign keys off like the app hosts.
pub fn open_schema_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(&complete_schema_sql()).unwrap();
    // The schema turns foreign keys on; the engine checks them once after the inserts, like the app hosts.
    conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
    conn
}

/// Every user table of a connection in the codec's input shape.
pub fn read_tables(conn: &Connection) -> Vec<CodecTableData> {
    let names: Vec<String> = query(conn, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name", &[]).unwrap().iter().map(|r| r["name"].as_str().unwrap().to_string()).collect();
    names
        .into_iter()
        .filter(|name| !vault_codec::is_skip_table(name))
        .map(|name| CodecTableData { records: query(conn, &format!("SELECT * FROM \"{}\"", name), &[]).unwrap().into_iter().map(|row| row.into_iter().collect()).collect(), name })
        .collect()
}

/// The names of the live items in a database, sorted.
pub fn item_names(conn: &Connection) -> Vec<String> {
    let mut names: Vec<String> = query(conn, "SELECT Name FROM Items WHERE IsDeleted = 0", &[]).unwrap().iter().map(|r| r["Name"].as_str().unwrap().to_string()).collect();
    names.sort();
    names
}

/// The first column of every row of `sql`, as text, sorted.
pub fn column(conn: &Connection, sql: &str) -> Vec<String> {
    let mut out: Vec<String> = query(conn, sql, &[]).unwrap().iter().map(|r| r.values().next().map(|v| v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string())).unwrap_or_default()).collect();
    out.sort();
    out
}

impl TestHost {
    /// A device holding an empty vault database under `vault_key`, with no at-rest blob stored yet.
    pub fn new(vault_key: &str) -> Self {
        Self {
            local: open_schema_db(),
            staging: None,
            state: HashMap::new(),
            vault_blob: None,
            vault_key: vault_key.to_string(),
            mutation_sequence: 0,
            is_dirty: false,
            mark_clean_calls: Vec::new(),
            store_calls: Vec::new(),
            rekeyed_stores: 0,
            requests: Vec::new(),
            responders: Vec::new(),
            logs: Vec::new(),
        }
    }

    /// A device under `vault_key` that talks to `server` and holds a cached key chain, like a device that logged in.
    pub fn logged_in(vault_key: &str, server: &Server) -> Self {
        let mut host = Self::new(vault_key);
        host.state.insert(state::ENCRYPTED_ACCOUNT_KEY.to_string(), json!("wrapped"));
        host.serve(server);
        host
    }

    /// Route every request this host makes to `server`.
    pub fn serve(&mut self, server: &Server) {
        let server = server.clone();
        self.responders.push(Box::new(move |method, path, body| server.borrow_mut().respond(method, path, body)));
    }

    /// Answer requests whose method and path match, ahead of the server.
    pub fn respond(&mut self, method: &'static str, path: &'static str, body: Value) {
        self.responders.insert(0, Box::new(move |m, p, _| if m == method && p == path { Some((200, body.clone())) } else { None }));
    }

    /// Answer the next matching request once, ahead of the server; the server answers from then on.
    pub fn respond_once(&mut self, method: &'static str, path: &'static str, body: Value) {
        let spent = std::cell::Cell::new(false);
        self.responders.insert(0, Box::new(move |m, p, _| if m == method && p == path && !spent.replace(true) { Some((200, body.clone())) } else { None }));
    }

    /// Record a value in the engine's persisted state.
    pub fn set_state(&mut self, key: &str, value: Value) {
        self.state.insert(key.to_string(), value);
    }

    /// Encrypt the local database as the at-rest blob, the way the app stores it.
    pub fn store_local_as_blob(&mut self) {
        let bytes = self.local.serialize(MAIN_DB).unwrap().to_vec();
        self.vault_blob = Some(crypto::symmetric_encrypt_bytes(&bytes, &self.vault_key).unwrap());
    }

    /// Change the local vault the way the app does: write rows, store the blob, count the mutation, mark dirty.
    pub fn edit(&mut self, change: impl FnOnce(&Connection)) {
        change(&self.local);
        self.store_local_as_blob();
        self.mutation_sequence += 1;
        self.is_dirty = true;
    }

    /// A full sync with the dirty state this host is in, under its own vault key.
    pub fn sync(&mut self) -> Value {
        let key = self.vault_key.clone();
        self.sync_as(&key)
    }

    /// A full sync under another session key than the vault is stored with.
    pub fn sync_as(&mut self, key: &str) -> Value {
        let scopes: Vec<&str> = if self.is_dirty { vec!["Main"] } else { vec![] };
        self.sync_scoped_as(key, &scopes)
    }

    /// A full sync that names the dirty scopes the app recorded.
    pub fn sync_scoped(&mut self, scopes: &[&str]) -> Value {
        let key = self.vault_key.clone();
        self.sync_scoped_as(&key, scopes)
    }

    fn sync_scoped_as(&mut self, key: &str, scopes: &[&str]) -> Value {
        let mut request = request_json("fullSync", key, self.is_dirty, self.mutation_sequence);
        request["dirtyScopes"] = json!(scopes);
        self.drive(&SyncSession::new(&request.to_string()).unwrap())
    }

    /// Any other operation (`migrationStatus`, `migrateManifest`, `statusCheck`, `resolveVaultKey`) under the vault key.
    pub fn run(&mut self, operation: &str) -> Value {
        let key = self.vault_key.clone();
        self.run_as(operation, &key)
    }

    pub fn run_as(&mut self, operation: &str, key: &str) -> Value {
        let request = request_json(operation, key, self.is_dirty, self.mutation_sequence);
        self.drive(&SyncSession::new(&request.to_string()).unwrap())
    }

    /// Drive a session to completion and return the `done` result.
    pub fn drive(&mut self, session: &SyncSession) -> Value {
        loop {
            let command: Command = serde_json::from_str(&session.next_command().unwrap()).unwrap();
            let response = match command {
                Command::Done { result } => return result,
                Command::Http { method, path, body, binary_response, binary_body, .. } => {
                    let body_json = if binary_body {
                        Some(frame_to_json(&path, &session.command_bytes().unwrap().expect("a binary body carries bytes")))
                    } else {
                        body.as_deref().map(|b| serde_json::from_str(b).unwrap_or(Value::String(b.to_string())))
                    };
                    let method = serde_json::to_value(method).unwrap().as_str().expect("http method serializes as text").to_string();
                    self.requests.push(RecordedRequest { method: method.clone(), path: path.clone(), body: body_json.clone() });
                    match self.responders.iter().find_map(|r| r(&method, &path, body_json.as_ref())) {
                        Some((status, body)) if binary_response && (200..300).contains(&status) => {
                            session.resume(&json!({ "status": status }).to_string(), Some(json_to_frame(&path, &body))).unwrap();
                            continue;
                        }
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
                Command::DbOpen { .. } => {
                    self.staging = Some(open_schema_db());
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
                Command::DbExport { db } => {
                    // The SQLite file travels as raw bytes, outside the JSON.
                    let bytes = self.db(db).serialize(MAIN_DB).unwrap().to_vec();
                    session.resume("{}", Some(bytes)).unwrap();
                    continue;
                }
                Command::VaultStore { encrypted_blob, mark_dirty, encryption_key, expected_mutation_seq, revision } => {
                    self.store_calls.push(Command::VaultStore { encrypted_blob: String::new(), mark_dirty, encryption_key: encryption_key.clone(), expected_mutation_seq, revision });
                    if let Some(key) = encryption_key {
                        // The app hosts hold the unlock key and derive the vault key from the cached chain.
                        let found_the_chain = self.state.contains_key(state::ENCRYPTED_ACCOUNT_KEY) && self.state.contains_key(state::ENCRYPTED_VEK);
                        assert!(found_the_chain, "a vault stored under a new key needs the chain that opens it cached first");
                        self.rekeyed_stores += 1;
                        self.vault_key = key;
                    }
                    // Like the app hosts: a sync store is refused after a mutation, and either kind may mark the vault dirty.
                    if expected_mutation_seq.is_some_and(|expected| expected != self.mutation_sequence) {
                        json!({ "success": false, "mutationSequence": self.mutation_sequence })
                    } else {
                        if mark_dirty {
                            self.mutation_sequence += 1;
                            self.is_dirty = true;
                        }
                        self.store_blob(&encrypted_blob);
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
            session.resume(&response.to_string(), None).unwrap();
        }
    }

    /// Store a blob and reload `local` from it, as the contract requires.
    fn store_blob(&mut self, encrypted_blob: &str) {
        self.vault_blob = Some(encrypted_blob.to_string());
        let bytes = state::decrypt_vault_blob(encrypted_blob, &self.vault_key).expect("stored blob decrypts with the vault key");
        self.local = open_from_bytes(&bytes);
    }

    fn db(&mut self, db: Db) -> &Connection {
        match db {
            Db::Local => &self.local,
            Db::Staging => self.staging.as_ref().expect("staging database opened"),
        }
    }

    /*
     * Readers.
     */

    pub fn item_names(&self) -> Vec<String> {
        item_names(&self.local)
    }

    pub fn requests_to(&self, path: &str) -> Vec<&RecordedRequest> {
        self.requests.iter().filter(|r| r.path == path).collect()
    }

    /// The `method path` of every request made, in order.
    pub fn request_log(&self) -> Vec<String> {
        self.requests.iter().map(|r| format!("{} {}", r.method, r.path)).collect()
    }

    /// The bodies of every `POST Vault`, in order.
    pub fn vault_writes(&self) -> Vec<Value> {
        self.requests.iter().filter(|r| r.method == "POST" && r.path == "Vault").map(|r| r.body.clone().unwrap()).collect()
    }

    pub fn last_vault_write(&self) -> Value {
        self.vault_writes().pop().expect("a vault write")
    }

    /// The stored at-rest vault decrypted and opened.
    pub fn stored_vault(&self) -> Connection {
        let bytes = state::decrypt_vault_blob(self.vault_blob.as_ref().expect("a stored vault"), &self.vault_key).unwrap();
        open_from_bytes(&bytes)
    }
}

/// The JSON of a sync request.
pub fn request_json(operation: &str, key: &str, dirty: bool, mutation_sequence: u64) -> Value {
    json!({
        "operation": operation,
        "username": USERNAME,
        "encryptionKey": key,
        "isDirty": dirty,
        "mutationSequence": mutation_sequence,
        "dirtyScopes": if dirty { vec!["Main"] } else { vec![] },
        "privateEmailDomains": ["private.io"],
        "minServerVersion": "0.12.0-dev",
    })
}

pub fn query(conn: &Connection, sql: &str, params: &[Value]) -> Result<Vec<Map<String, Value>>, String> {
    sqlite_host::query(conn, sql, params).map_err(|e| e.to_string())
}

pub fn exec(conn: &Connection, statements: &[SqlStatement]) -> Result<(), String> {
    sqlite_host::exec(conn, statements).map_err(|e| e.to_string())
}

/*
 * Responders and the fake server speak JSON with each ciphertext as a base64 field; the engine sends and reads binary
 * frames. These convert between the two.
 */

/// The base64 fields that travel as frame parts, per list, for a request to or response from `path`.
fn frame_fields(path: &str, upload: bool) -> &'static [(&'static str, &'static str)] {
    match path {
        "Vault/blobs" | "Vault/blobs/download" => &[("blobs", "encryptedDataBase64")],
        _ if upload => &[("manifests", "manifestBlob"), ("buckets", "blob")],
        _ => &[("manifests", "blob"), ("buckets", "blob")],
    }
}

/// The server's binary frame for a scripted JSON response.
fn json_to_frame(path: &str, body: &Value) -> Vec<u8> {
    let mut header = body.clone();
    let mut data = Vec::new();
    for (list, field) in frame_fields(path, false) {
        for entry in header.get_mut(*list).and_then(Value::as_array_mut).into_iter().flatten() {
            let base64 = entry.as_object_mut().unwrap().remove(*field);
            let bytes = base64.as_ref().and_then(Value::as_str).map(|b| crate::common::encoding::base64_decode(b).unwrap()).unwrap_or_default();
            entry["offset"] = json!(data.len());
            entry["size"] = json!(bytes.len());
            data.extend(bytes);
        }
    }
    let header = serde_json::to_vec(&header).unwrap();
    [&(header.len() as u32).to_be_bytes()[..], &header, &data].concat()
}

/// The JSON an uploaded binary frame stands for.
fn frame_to_json(path: &str, frame: &[u8]) -> Value {
    let header_length = u32::from_be_bytes(frame[..4].try_into().unwrap()) as usize;
    let mut header: Value = serde_json::from_slice(&frame[4..4 + header_length]).unwrap();
    let data = &frame[4 + header_length..];
    let mut listed = 0;
    for (list, field) in frame_fields(path, true) {
        for entry in header.get_mut(*list).and_then(Value::as_array_mut).into_iter().flatten() {
            let entry = entry.as_object_mut().unwrap();
            let offset = entry.remove("offset").and_then(|o| o.as_u64()).expect("each part has an offset") as usize;
            let size = entry.remove("size").and_then(|s| s.as_u64()).expect("each part has a size") as usize;
            entry.insert(field.to_string(), json!(crate::common::encoding::base64_encode(&data[offset..offset + size])));
            listed += size;
        }
    }
    assert_eq!(listed, data.len(), "the client sends only the ciphertexts its header lists");
    header
}
