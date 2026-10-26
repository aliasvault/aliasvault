use crate::crypto::avex::*;

/// An export written by a 0.28.0 client; a failure means released exports no longer import.
const FIXTURE: &[u8] = include_bytes!("../../../../client/src/transfer/import/importers/aliasvault/__tests__/aliasvault.avex");
const FIXTURE_PASSWORD: &str = "testexportpass123";

#[test]
fn decrypts_a_released_export() {
    let header = avex_parse_header(FIXTURE).unwrap();
    assert_eq!(header.metadata.app_version.as_deref(), Some("0.28.0-alpha-dev"));
    let avux = avex_decrypt(FIXTURE, FIXTURE_PASSWORD).unwrap();
    assert!(avux.starts_with(b"PK\x03\x04"), "the payload is the .avux zip");
}

#[test]
fn rejects_a_wrong_password() {
    assert_eq!(avex_decrypt(FIXTURE, "wrong-password"), Err(AvexError::Decryption));
}

#[test]
fn round_trips_with_the_export_parameters() {
    let avex = avex_encrypt(b"avux bytes", "export-password", "2026-10-26T10:00:00.000Z", "0.31.0").unwrap();
    let header = avex_parse_header(&avex).unwrap();
    assert_eq!((header.format.as_str(), header.version.as_str(), header.kdf.kdf_type.as_str()), (AVEX_FORMAT, AVEX_FORMAT_VERSION, "Argon2Id"));
    assert_eq!(header.kdf.params, AvexKdfParams { degree_of_parallelism: 1, memory_size: 262144, iterations: 3 });
    assert_eq!(header.metadata, AvexMetadata { exported_at: "2026-10-26T10:00:00.000Z".to_string(), app_version: Some("0.31.0".to_string()) });

    let offset = header.encryption.encrypted_data_offset as usize;
    assert_eq!(&avex[offset - AVEX_HEADER_DELIMITER.len()..offset], AVEX_HEADER_DELIMITER.as_bytes(), "the recorded offset points at the payload");
    assert_eq!(*avex_decrypt(&avex, "export-password").unwrap(), b"avux bytes");
}

#[test]
fn rejects_files_it_does_not_read() {
    let with_header = |json: &str| [json.as_bytes(), AVEX_HEADER_DELIMITER.as_bytes(), b"payload"].concat();
    let kdf = r#""kdf":{"type":"Argon2Id","salt":"c2FsdHNhbHQ=","params":{"DegreeOfParallelism":1,"MemorySize":19456,"Iterations":2}}"#;

    assert!(matches!(avex_parse_header(b"not an export"), Err(AvexError::InvalidFile(_))));
    assert!(avex_parse_header(&with_header(&format!(r#"{{"format":"avex","version":"1.0.0",{kdf}}}"#))).is_ok());
    assert!(matches!(avex_parse_header(&with_header(&format!(r#"{{"format":"avux","version":"1.0.0",{kdf}}}"#))), Err(AvexError::InvalidFile(_))));
    assert!(matches!(avex_parse_header(&with_header(&format!(r#"{{"format":"avex","version":"2.0.0",{kdf}}}"#))), Err(AvexError::InvalidFile(_))));
    assert!(matches!(avex_parse_header(&with_header(&format!(r#"{{"format":"avex","version":"1.0.0",{}}}"#, kdf.replace("Argon2Id", "Pbkdf2")))), Err(AvexError::InvalidFile(_))));
}
