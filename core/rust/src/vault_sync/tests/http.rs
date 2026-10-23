use crate::vault_sync::http::*;
use crate::vault_sync::errors::SyncError;
use crate::vault_sync::types::{FailureFields, HttpResponse};

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
