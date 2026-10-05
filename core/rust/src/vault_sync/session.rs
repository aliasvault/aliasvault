//! The command loop.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

use serde::de::DeserializeOwned;
use serde_json::Value;

use super::engine;
use super::errors::{SyncError, SyncResult};
use super::types::{Ack, Command, LogLevel, SyncRequest};
use crate::common::error::{VaultError, VaultResult};

/// The exchange point between the engine's future and the host.
#[derive(Default)]
pub(crate) struct Slot {
    pub pending: Option<Command>,
    pub response: Option<Value>,
    /// Raw bytes the host handed back with the response (the SQLite file of a `dbExport`).
    pub response_bytes: Option<Vec<u8>>,
}

/// The engine's handle to the host.
#[derive(Clone)]
pub(crate) struct Host {
    slot: Arc<Mutex<Slot>>,
}

impl Host {
    pub fn new(slot: Arc<Mutex<Slot>>) -> Self {
        Self { slot }
    }

    /// Send a command and wait for the host's typed response. A `{ "error": ... }` response becomes an error.
    pub async fn call<R: DeserializeOwned>(&self, command: Command) -> SyncResult<R> {
        Ok(self.call_with_bytes(command).await?.0)
    }

    /// Like [`Host::call`], also returning the raw bytes the host attached to its response, if any.
    pub async fn call_with_bytes<R: DeserializeOwned>(&self, command: Command) -> SyncResult<(R, Option<Vec<u8>>)> {
        let kind = command.name();
        let (response, bytes) = CommandFuture { slot: self.slot.clone(), command: Some(command), sent: false }.await;
        if let Some(error) = response.get("error").and_then(Value::as_str) {
            return Err(SyncError::Host { command: kind, message: error.to_string() });
        }
        let typed = serde_json::from_value(response).map_err(|e| SyncError::Host { command: kind, message: format!("unexpected response shape: {}", e) })?;
        Ok((typed, bytes))
    }

    /// Emit a log line.
    pub async fn log(&self, level: LogLevel, message: impl Into<String>) {
        let _ = self.call::<Ack>(Command::Log { level, message: message.into() }).await;
    }
}

/// Parks the engine until the host has fed the response to one command.
struct CommandFuture {
    slot: Arc<Mutex<Slot>>,
    command: Option<Command>,
    sent: bool,
}

impl Future for CommandFuture {
    type Output = (Value, Option<Vec<u8>>);

    fn poll(mut self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Self::Output> {
        let this = &mut *self;
        if !this.sent {
            this.slot.lock().expect("sync host slot poisoned").pending = this.command.take();
            this.sent = true;
            return Poll::Pending;
        }
        let mut slot = this.slot.lock().expect("sync host slot poisoned");
        match slot.response.take() {
            Some(response) => Poll::Ready((response, slot.response_bytes.take())),
            None => Poll::Pending,
        }
    }
}

/// A running engine operation.
pub struct SyncSession {
    inner: Mutex<SessionInner>,
}

struct SessionInner {
    slot: Arc<Mutex<Slot>>,
    future: Option<Pin<Box<dyn Future<Output = Value> + Send>>>,
    finished: Option<Value>,
}

impl SyncSession {
    /// Start an operation.
    pub fn new(request_json: &str) -> VaultResult<Self> {
        let request: SyncRequest = serde_json::from_str(request_json).map_err(|e| VaultError::General(format!("Invalid sync request: {}", e)))?;
        let slot = Arc::new(Mutex::new(Slot::default()));
        let host = Host::new(slot.clone());
        let future: Pin<Box<dyn Future<Output = Value> + Send>> = Box::pin(engine::run(host, request));
        Ok(Self { inner: Mutex::new(SessionInner { slot, future: Some(future), finished: None }) })
    }

    /// The next command for the host, as JSON.
    pub fn next_command(&self) -> VaultResult<String> {
        let mut inner = self.inner.lock().map_err(|_| VaultError::General("sync session poisoned".to_string()))?;
        if let Some(result) = &inner.finished {
            return Ok(serde_json::to_string(&Command::Done { result: result.clone() })?);
        }

        let mut context = Context::from_waker(Waker::noop());
        let future = inner.future.as_mut().ok_or_else(|| VaultError::General("sync session has no operation".to_string()))?;
        match future.as_mut().poll(&mut context) {
            Poll::Ready(result) => {
                inner.future = None;
                inner.finished = Some(result.clone());
                Ok(serde_json::to_string(&Command::Done { result })?)
            }
            Poll::Pending => {
                let pending = inner.slot.lock().map_err(|_| VaultError::General("sync host slot poisoned".to_string()))?.pending.take();
                match pending {
                    Some(command) => Ok(serde_json::to_string(&command)?),
                    None => Err(VaultError::General("sync session is waiting for a response to its last command".to_string())),
                }
            }
        }
    }

    /// Hand the host's response to the last command back, with raw bytes for a `dbExport` (the SQLite file).
    pub fn resume(&self, response_json: &str, bytes: Option<Vec<u8>>) -> VaultResult<()> {
        let response: Value = if response_json.trim().is_empty() {
            Value::Object(Default::default())
        } else {
            serde_json::from_str(response_json).map_err(|e| VaultError::General(format!("Invalid host response: {}", e)))?
        };
        let inner = self.inner.lock().map_err(|_| VaultError::General("sync session poisoned".to_string()))?;
        let mut slot = inner.slot.lock().map_err(|_| VaultError::General("sync host slot poisoned".to_string()))?;
        slot.response = Some(response);
        slot.response_bytes = bytes;
        Ok(())
    }
}
