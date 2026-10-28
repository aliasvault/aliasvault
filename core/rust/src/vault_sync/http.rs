//! API calls through the host's transport.

use serde::de::DeserializeOwned;
use serde::Serialize;

use super::errors::{SyncError, SyncResult};
use super::frame::{self, FrameBody};
use super::session::Host;
use super::types::{Command, HttpMethod, HttpResponse, LogLevel, StatusResponse};

/// A request body.
enum Body {
    None,
    Json(String),
    Frame(Vec<u8>),
}

/// Send a request, reading a `binary_response` as raw bytes instead of `body` text.
async fn send(host: &Host, method: HttpMethod, path: &str, body: Body, large_transfer: bool, binary_response: bool) -> SyncResult<(HttpResponse, Option<Vec<u8>>)> {
    let (body, binary_body, bytes) = match body {
        Body::None => (None, false, None),
        Body::Json(json) => (Some(json), false, None),
        Body::Frame(frame) => (None, true, Some(frame)),
    };
    let command = Command::Http { method, path: path.to_string(), body, auth: true, large_transfer, binary_response, binary_body };
    let (response, bytes): (HttpResponse, _) = host.call_with_bytes(command, bytes).await?;
    if response.status == 0 {
        let message = response.transport_error.unwrap_or_else(|| "request failed".to_string());
        return Err(if response.timed_out { SyncError::Timeout(message) } else { SyncError::Network(message) });
    }
    if response.status == 426 {
        return Err(SyncError::ClientUpgradeRequired);
    }
    Ok((response, bytes))
}

/// Send a request that answers with JSON and return the checked body.
async fn send_json(host: &Host, method: HttpMethod, path: &str, body: Body, large_transfer: bool) -> SyncResult<String> {
    check(send(host, method, path, body, large_transfer, false).await?.0)
}

/// Send a request that answers with a binary frame and decode it.
async fn send_for_frame<T: FrameBody + DeserializeOwned>(host: &Host, method: HttpMethod, path: &str, body: Body) -> SyncResult<T> {
    let (response, bytes) = send(host, method, path, body, true, true).await?;
    check(response)?;
    // No bytes means the host could not read the body: a transfer failure, not a damaged vault.
    frame::decode(&bytes.ok_or_else(|| SyncError::Network(format!("{} answered without a body", path)))?)
}

/// The body of a successful response, or the error the status maps to.
pub(super) fn check(response: HttpResponse) -> SyncResult<String> {
    let code = api_error_code(&response.body);
    match response.status {
        200..=299 => Ok(response.body),
        401 => Err(SyncError::Auth),
        // A coded 403 is a refusal, not a dead session.
        403 if code.is_none() => Err(SyncError::Auth),
        413 => Err(SyncError::PayloadTooLarge),
        status => Err(SyncError::Http { status, code, body: response.body }),
    }
}

/// The API error code an error body names.
pub(crate) fn api_error_code(body: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(body).ok()?;
    parsed.get("code")?.as_str().filter(|code| is_api_error_code(code)).map(str::to_string)
}

/// Server error codes are uppercase enum names.
fn is_api_error_code(value: &str) -> bool {
    (2..=64).contains(&value.len()) && value.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

fn parse<T: DeserializeOwned>(body: &str) -> SyncResult<T> {
    Ok(serde_json::from_str(body)?)
}

/// Authenticated GET of a v2 endpoint.
pub(crate) async fn get<T: DeserializeOwned>(host: &Host, path: &str, large_transfer: bool) -> SyncResult<T> {
    parse(&send_json(host, HttpMethod::Get, path, Body::None, large_transfer).await?)
}

/// Authenticated POST of a v2 endpoint with a JSON body.
pub(crate) async fn post<B: Serialize, T: DeserializeOwned>(host: &Host, path: &str, body: &B, large_transfer: bool) -> SyncResult<T> {
    parse(&send_json(host, HttpMethod::Post, path, Body::Json(serde_json::to_string(body)?), large_transfer).await?)
}

/// Authenticated POST that returns no body.
pub(crate) async fn post_no_content<B: Serialize>(host: &Host, path: &str, body: &B) -> SyncResult<()> {
    send_json(host, HttpMethod::Post, path, Body::Json(serde_json::to_string(body)?), false).await?;
    Ok(())
}

/// Authenticated GET of a v2 endpoint that answers with a binary frame.
pub(crate) async fn get_frame<T: FrameBody + DeserializeOwned>(host: &Host, path: &str) -> SyncResult<T> {
    send_for_frame(host, HttpMethod::Get, path, Body::None).await
}

/// Authenticated POST of a v2 endpoint with a JSON body that answers with a binary frame.
pub(crate) async fn post_for_frame<B: Serialize, T: FrameBody + DeserializeOwned>(host: &Host, path: &str, body: &B) -> SyncResult<T> {
    send_for_frame(host, HttpMethod::Post, path, Body::Json(serde_json::to_string(body)?)).await
}

/// Authenticated POST of a v2 endpoint with a binary frame body and a JSON response.
pub(crate) async fn post_frame<B: FrameBody + Serialize, T: DeserializeOwned>(host: &Host, path: &str, body: &mut B) -> SyncResult<T> {
    parse(&send_json(host, HttpMethod::Post, path, Body::Frame(frame::encode(body)?), true).await?)
}

/// `GET`/`POST v2/Vault`.
pub(crate) const VAULT_ENDPOINT: &str = "Vault";

/// `GET v2/VaultKey/Password`: the account's key chain encrypted under the password.
// LEGACY: servers before 0.32.0 serve the key chain at this URL only. TODO: switch to "UnlockMethod/Password" once the
// minimum API version is 0.32.0+.
pub(crate) const VAULT_KEY_PASSWORD_ENDPOINT: &str = "VaultKey/Password";

/// Max ciphertext bytes in one blob transfer request or response body.
pub(crate) const BLOB_TRANSFER_BATCH_MAX_BYTES: usize = 4 * 1024 * 1024;

/// The server's cap on blobs per transfer batch.
pub(crate) const BLOB_TRANSFER_BATCH_MAX_COUNT: usize = 100;

/// The server's cap on hashes per `blobs/missing` or `blobs/download` request.
pub(crate) const BLOB_HASH_REQUEST_MAX_COUNT: usize = 1000;

/// Split items into transfer batches bounded by both blob transfer limits.
pub(crate) fn batch_by_transfer_cost<T>(items: Vec<T>, cost_of: impl Fn(&T) -> usize) -> Vec<Vec<T>> {
    let mut batches = Vec::new();
    let mut batch = Vec::new();
    let mut bytes = 0usize;
    for item in items {
        let cost = cost_of(&item);
        if !batch.is_empty() && (bytes + cost > BLOB_TRANSFER_BATCH_MAX_BYTES || batch.len() >= BLOB_TRANSFER_BATCH_MAX_COUNT) {
            batches.push(std::mem::take(&mut batch));
            bytes = 0;
        }
        batch.push(item);
        bytes += cost;
    }
    if !batch.is_empty() {
        batches.push(batch);
    }
    batches
}

/// Read an uncoded 404 as a server that predates the v2 API.
pub(crate) fn with_outdated_server_guard<T>(result: SyncResult<T>) -> SyncResult<T> {
    match result {
        Err(SyncError::Http { status: 404, code: None, .. }) => Err(SyncError::ServerUpdateRequired),
        other => other,
    }
}

/// The server version a status call reports when the server cannot be reached.
pub(crate) const SERVER_UNREACHABLE_VERSION: &str = "0.0.0";

/// `GET v2/Status`; a transport failure or a 5xx reads as server version [`SERVER_UNREACHABLE_VERSION`].
pub(crate) async fn get_status(host: &Host) -> SyncResult<StatusResponse> {
    match with_outdated_server_guard(get::<StatusResponse>(host, "Status", false).await) {
        Err(error @ (SyncError::Network(_) | SyncError::Timeout(_) | SyncError::Http { status: 500..=599, .. })) => {
            host.log(LogLevel::Warn, format!("[Sync] Status call failed, treating the server as unreachable: {}", error)).await;
            Ok(StatusResponse { client_version_supported: true, server_version: SERVER_UNREACHABLE_VERSION.to_string(), ..Default::default() })
        }
        other => other,
    }
}
