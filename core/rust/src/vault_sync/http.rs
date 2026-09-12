//! API calls through the host's transport.

use serde::de::DeserializeOwned;
use serde::Serialize;

use super::errors::{SyncError, SyncResult};
use super::session::Host;
use super::types::{Command, HttpMethod, HttpResponse, LogLevel, StatusResponse};

async fn send(host: &Host, method: HttpMethod, path: &str, body: Option<String>, auth: bool, large_transfer: bool) -> SyncResult<HttpResponse> {
    let response: HttpResponse = host.call(Command::Http { method, path: path.to_string(), body, auth, large_transfer }).await?;
    if response.status == 0 {
        let message = response.transport_error.unwrap_or_else(|| "request failed".to_string());
        return Err(if response.timed_out { SyncError::Timeout(message) } else { SyncError::Network(message) });
    }
    if response.status == 426 {
        return Err(SyncError::ClientUpgradeRequired);
    }
    Ok(response)
}

fn check(response: HttpResponse) -> SyncResult<String> {
    match response.status {
        200..=299 => Ok(response.body),
        401 | 403 => Err(SyncError::Auth),
        413 => Err(SyncError::PayloadTooLarge),
        status => Err(SyncError::Http { status, body: response.body }),
    }
}

fn parse<T: DeserializeOwned>(body: &str) -> SyncResult<T> {
    serde_json::from_str(body).map_err(|e| SyncError::Other(format!("Unexpected API response: {}", e)))
}

fn v2(path: &str) -> String {
    format!("v2/{}", path)
}

/// Authenticated GET of a v2 endpoint.
pub(crate) async fn get<T: DeserializeOwned>(host: &Host, path: &str, large_transfer: bool) -> SyncResult<T> {
    let body = check(send(host, HttpMethod::Get, &v2(path), None, true, large_transfer).await?)?;
    parse(&body)
}

/// Authenticated POST of a v2 endpoint with a JSON body.
pub(crate) async fn post<B: Serialize, T: DeserializeOwned>(host: &Host, path: &str, body: &B, large_transfer: bool) -> SyncResult<T> {
    let body = check(send(host, HttpMethod::Post, &v2(path), Some(serde_json::to_string(body)?), true, large_transfer).await?)?;
    parse(&body)
}

/// Authenticated POST that returns no body.
pub(crate) async fn post_no_content<B: Serialize>(host: &Host, path: &str, body: &B) -> SyncResult<()> {
    check(send(host, HttpMethod::Post, &v2(path), Some(serde_json::to_string(body)?), true, false).await?)?;
    Ok(())
}

/// Authenticated DELETE of a v2 endpoint.
pub(crate) async fn delete(host: &Host, path: &str) -> SyncResult<()> {
    check(send(host, HttpMethod::Delete, &v2(path), None, true, false).await?)?;
    Ok(())
}

/// The v2 vault endpoint (`GET`/`POST v2/Vault`).
pub(crate) const VAULT_ENDPOINT: &str = "Vault";

/// Max base64 characters in one blob transfer request or response body.
pub(crate) const BLOB_TRANSFER_BATCH_MAX_CHARS: usize = 4 * 1024 * 1024;

/// Upper bound on the number of blobs in one transfer batch.
pub(crate) const BLOB_TRANSFER_BATCH_MAX_COUNT: usize = 100;

/// Split items into transfer batches bounded by both blob transfer limits.
pub(crate) fn batch_by_transfer_cost<T>(items: Vec<T>, cost_of: impl Fn(&T) -> usize) -> Vec<Vec<T>> {
    let mut batches = Vec::new();
    let mut batch = Vec::new();
    let mut chars = 0usize;
    for item in items {
        let cost = cost_of(&item);
        if !batch.is_empty() && (chars + cost > BLOB_TRANSFER_BATCH_MAX_CHARS || batch.len() >= BLOB_TRANSFER_BATCH_MAX_COUNT) {
            batches.push(std::mem::take(&mut batch));
            chars = 0;
        }
        batch.push(item);
        chars += cost;
    }
    if !batch.is_empty() {
        batches.push(batch);
    }
    batches
}

/// Turn a 404 from a v2 vault endpoint into "the server predates the v2 API".
pub(crate) fn with_outdated_server_guard<T>(result: SyncResult<T>) -> SyncResult<T> {
    match result {
        Err(SyncError::Http { status: 404, .. }) => Err(SyncError::ServerUpdateRequired),
        other => other,
    }
}

/// The server version a status call reports when the server cannot be reached.
pub(crate) const SERVER_UNREACHABLE_VERSION: &str = "0.0.0";

/// `GET v2/Status`. Anything but an auth failure or a client-version refusal reads as "server unreachable",
/// reported as server version [`SERVER_UNREACHABLE_VERSION`] so the caller can go offline.
pub(crate) async fn get_status(host: &Host) -> SyncResult<StatusResponse> {
    match get::<StatusResponse>(host, "Status", false).await {
        Ok(status) => Ok(status),
        Err(SyncError::Auth) => Err(SyncError::Auth),
        Err(SyncError::ClientUpgradeRequired) => Err(SyncError::ClientUpgradeRequired),
        Err(error) => {
            host.log(LogLevel::Warn, format!("[VaultSync] Status call failed, treating the server as unreachable: {}", error)).await;
            Ok(StatusResponse { client_version_supported: true, server_version: SERVER_UNREACHABLE_VERSION.to_string(), ..Default::default() })
        }
    }
}
