//! API calls through the host's transport.

use serde::de::DeserializeOwned;
use serde::Serialize;

use super::errors::{SyncError, SyncResult};
use super::frame::{self, FrameBody};
use super::session::Host;
use super::types::{Command, HttpMethod, HttpResponse, LogLevel, StatusResponse};

/// A request body: none, JSON text, or a binary frame the host sends as `application/octet-stream`.
enum Body {
    None,
    Json(String),
    Frame(Vec<u8>),
}

/// Send a request; with `binary_response` a successful response comes back as raw bytes instead of as `body` text.
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
    // A host that could not read the body hands back no bytes: a transfer failure, not a damaged vault.
    frame::decode(&bytes.ok_or_else(|| SyncError::Network(format!("{} answered without a body", path)))?)
}

fn check(response: HttpResponse) -> SyncResult<String> {
    let code = api_error_code(&response.body);
    match response.status {
        200..=299 => Ok(response.body),
        401 => Err(SyncError::Auth),
        // A coded 403 is a refusal (e.g. `CAPABILITY_NOT_AVAILABLE`), not a dead session.
        403 if code.is_none() => Err(SyncError::Auth),
        413 => Err(SyncError::PayloadTooLarge),
        status => Err(SyncError::Http { status, code, body: response.body }),
    }
}

/// The API error code a v2 error body (`{"code": "...", "statusCode": ...}`) names.
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

/// Authenticated DELETE of a v2 endpoint.
pub(crate) async fn delete(host: &Host, path: &str) -> SyncResult<()> {
    send_json(host, HttpMethod::Delete, path, Body::None, false).await?;
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

/// The v2 vault endpoint (`GET`/`POST v2/Vault`).
pub(crate) const VAULT_ENDPOINT: &str = "Vault";

/// The v2 vault key endpoint (`GET v2/VaultKey/Password`): the account's password-wrapped key chain.
pub(crate) const VAULT_KEY_PASSWORD_ENDPOINT: &str = "VaultKey/Password";

/// Max ciphertext bytes in one blob transfer request or response body.
pub(crate) const BLOB_TRANSFER_BATCH_MAX_BYTES: usize = 4 * 1024 * 1024;

/// Upper bound on the number of blobs in one transfer batch (the server's `VaultWriteLimits.MaxBlobsPerUpload`).
pub(crate) const BLOB_TRANSFER_BATCH_MAX_COUNT: usize = 100;

/// Upper bound on the number of hashes in one `blobs/missing` or `blobs/download` request (the server's `VaultWriteLimits.MaxHashesPerRequest`).
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

/// Turn an uncoded 404 (a route miss) from a v2 vault endpoint into "the server predates the v2 API".
pub(crate) fn with_outdated_server_guard<T>(result: SyncResult<T>) -> SyncResult<T> {
    match result {
        Err(SyncError::Http { status: 404, code: None, .. }) => Err(SyncError::ServerUpdateRequired),
        other => other,
    }
}

/// The server version a status call reports when the server cannot be reached.
pub(crate) const SERVER_UNREACHABLE_VERSION: &str = "0.0.0";

/// `GET v2/Status`. A transport failure or a 5xx reads as "server unreachable", reported as server version
/// [`SERVER_UNREACHABLE_VERSION`] so the caller can go offline; every other failure is returned.
pub(crate) async fn get_status(host: &Host) -> SyncResult<StatusResponse> {
    match with_outdated_server_guard(get::<StatusResponse>(host, "Status", false).await) {
        Err(error @ (SyncError::Network(_) | SyncError::Timeout(_) | SyncError::Http { status: 500..=599, .. })) => {
            host.log(LogLevel::Warn, format!("[Sync] Status call failed, treating the server as unreachable: {}", error)).await;
            Ok(StatusResponse { client_version_supported: true, server_version: SERVER_UNREACHABLE_VERSION.to_string(), ..Default::default() })
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault_sync::types::FailureFields;

    fn response(status: u16, body: &str) -> HttpResponse {
        HttpResponse { status, body: body.to_string(), transport_error: None, timed_out: false }
    }

    #[test]
    fn a_refusal_keeps_the_server_code() {
        let error = check(response(400, r#"{"code":"INVALID_REQUEST","statusCode":400}"#)).unwrap_err();
        assert_eq!(error.api_error_code().as_deref(), Some("INVALID_REQUEST"));
        assert_eq!(FailureFields::from(&error).api_error_code.as_deref(), Some("INVALID_REQUEST"));
    }

    #[test]
    fn a_body_without_a_code_yields_none() {
        assert_eq!(check(response(500, "")).unwrap_err().api_error_code(), None);
        assert_eq!(check(response(502, "<html>Bad gateway</html>")).unwrap_err().api_error_code(), None);
        assert_eq!(check(response(400, r#"{"code":"not a code"}"#)).unwrap_err().api_error_code(), None);
    }

    #[test]
    fn only_an_uncoded_403_ends_the_session() {
        assert!(matches!(check(response(403, "")), Err(SyncError::Auth)));
        let refused = check(response(403, r#"{"code":"CAPABILITY_NOT_AVAILABLE","statusCode":403}"#)).unwrap_err();
        assert_eq!(refused.api_error_code().as_deref(), Some("CAPABILITY_NOT_AVAILABLE"));
    }

    #[test]
    fn only_an_uncoded_404_means_an_outdated_server() {
        assert!(matches!(with_outdated_server_guard::<()>(check(response(404, "")).map(|_| ())), Err(SyncError::ServerUpdateRequired)));
        let coded = with_outdated_server_guard::<()>(check(response(404, r#"{"code":"SHARED_MANIFEST_NOT_FOUND","statusCode":404}"#)).map(|_| ())).unwrap_err();
        assert_eq!(coded.api_error_code().as_deref(), Some("SHARED_MANIFEST_NOT_FOUND"));
    }
}
