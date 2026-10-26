use crate::common::encoding::base64_encode;
use crate::crypto::argon2::*;

#[test]
fn parses_complete_settings() {
    let params = Argon2Params::from_settings_json(r#"{"DegreeOfParallelism":1,"MemorySize":65536,"Iterations":5}"#).unwrap();
    assert_eq!(params, Argon2Params { memory_kib: 65536, iterations: 5, parallelism: 1 });
}

#[test]
fn rejects_incomplete_or_empty_settings() {
    for settings in ["", "{}", r#"{"MemorySize":65536,"Iterations":5}"#] {
        assert!(matches!(Argon2Params::from_settings_json(settings), Err(Argon2Error::InvalidSettings(_))), "accepted {settings:?}");
    }
}

#[test]
fn rejects_params_below_the_minimum() {
    for settings in [r#"{"DegreeOfParallelism":1,"MemorySize":19455,"Iterations":2}"#, r#"{"DegreeOfParallelism":1,"MemorySize":65536,"Iterations":1}"#, r#"{"DegreeOfParallelism":0,"MemorySize":65536,"Iterations":5}"#] {
        assert!(matches!(derive("password", "user@example.tld", settings), Err(Argon2Error::InvalidParameter(_))), "accepted {settings}");
    }
}

/// Expected keys come from libargon2 (argon2-cffi), for the pre-0.31.0 and the current default settings. A different
/// output means existing accounts can no longer derive their key. Never regenerate them.
#[test]
fn matches_the_reference_implementation() {
    let cases = [
        (r#"{"DegreeOfParallelism":1,"MemorySize":19456,"Iterations":2}"#, "l12OncuAll3SmDPkfv2sHtxaoEVsCXfuFulTShtBfxA="),
        (r#"{"DegreeOfParallelism":1,"MemorySize":65536,"Iterations":5}"#, "j7bnKpt3W46ak6Qid2JENR7NxznhfgRNDWAImnpAc40="),
    ];
    for (settings, expected) in cases {
        let key = derive("password", "user@example.tld", settings).unwrap();
        assert_eq!(base64_encode(&key), expected, "settings {settings}");
    }
}

fn derive(password: &str, salt: &str, settings: &str) -> Result<zeroize::Zeroizing<Vec<u8>>, Argon2Error> {
    argon2_derive_key(password.as_bytes(), salt.as_bytes(), Argon2Params::from_settings_json(settings)?)
}
