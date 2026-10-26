//! The .avex encrypted vault export: a JSON header, a delimiter, then the .avux bytes encrypted with AES-256-GCM under an
//! Argon2id key of the export password.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::Zeroizing;

use crate::common::encoding::base64_encode;
use crate::common::error::{VaultError, VaultResult};
use crate::common::rng::random_bytes;
use crate::crypto::aes_gcm;
use crate::crypto::argon2::{argon2_derive_key, Argon2Error, Argon2Params};

/// Separates the JSON header from the encrypted payload.
pub const AVEX_HEADER_DELIMITER: &str = "\n-----BEGIN ENCRYPTED DATA-----\n";

/// The `format` of every .avex header.
pub const AVEX_FORMAT: &str = "avex";

/*
 * The version of the container itself, independent of the app version that wrote it. A new version must keep
 * reading the old one.
 * Version history:
 * - 1.0.0: Initial .avex format with Argon2id KDF + AES-256-GCM encryption.
 */
pub const AVEX_FORMAT_VERSION: &str = "1.0.0";

/// The KDF a new export is written with: plain Argon2id, independent of the account's login encryption type.
const AVEX_KDF_TYPE: &str = "Argon2Id";

const AVEX_ENCRYPTION_ALGORITHM: &str = "AES-256-GCM";

/// Length of the random salt; the KDF hashes the UTF-8 characters of its base64 string.
const AVEX_SALT_LENGTH: usize = 32;

/// The Argon2id parameters a new export is encrypted with.
const AVEX_KDF_PARAMS: AvexKdfParams = AvexKdfParams { degree_of_parallelism: 1, memory_size: 262144, iterations: 3 };

/// Why an .avex file could not be read.
#[derive(Error, Debug, Clone, PartialEq, Eq)]
pub enum AvexError {
    /// The bytes are not an .avex file this version reads.
    #[error("Invalid .avex file: {0}")]
    InvalidFile(String),

    /// The payload did not decrypt: a wrong password or a corrupt payload.
    #[error("Failed to decrypt .avex file. The password may be incorrect or the file may be corrupted.")]
    Decryption,
}

/// The header of an .avex file, with its JSON wire names.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvexHeader {
    /// Always [`AVEX_FORMAT`].
    pub format: String,
    /// The container format version (not the app version).
    pub version: String,
    /// How the key is derived from the export password.
    pub kdf: AvexKdf,
    /// How the payload is encrypted.
    #[serde(default)]
    pub encryption: AvexEncryption,
    /// When and by which app version the export was written.
    #[serde(default)]
    pub metadata: AvexMetadata,
}

/// Key derivation of an .avex file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AvexKdf {
    /// The KDF name; only Argon2id is read.
    #[serde(rename = "type")]
    pub kdf_type: String,
    /// The base64 salt.
    pub salt: String,
    /// The Argon2id cost parameters.
    pub params: AvexKdfParams,
}

/// Argon2id cost parameters, keyed like the account's `EncryptionSettings`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AvexKdfParams {
    /// Number of lanes.
    pub degree_of_parallelism: u32,
    /// Memory cost in KiB.
    pub memory_size: u32,
    /// Number of passes.
    pub iterations: u32,
}

/// Payload encryption of an .avex file.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvexEncryption {
    /// Always AES-256-GCM.
    #[serde(default)]
    pub algorithm: String,
    /// Byte offset of the payload; informative only, the reader looks for the delimiter.
    #[serde(default)]
    pub encrypted_data_offset: u64,
}

/// Export metadata of an .avex file.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvexMetadata {
    /// ISO 8601 time of the export.
    #[serde(default)]
    pub exported_at: String,
    /// The app version that wrote the export.
    #[serde(default)]
    pub app_version: Option<String>,
}

/// Encrypt .avux bytes into an .avex file under the export password.
pub fn avex_encrypt(avux: &[u8], password: &str, exported_at: &str, app_version: &str) -> VaultResult<Vec<u8>> {
    let salt = base64_encode(&random_bytes(AVEX_SALT_LENGTH));
    let key = derive_key(password, &salt, AVEX_KDF_PARAMS).map_err(|e| VaultError::General(e.to_string()))?;
    let payload = aes_gcm::encrypt(avux, &key, &[])?;

    let mut header = AvexHeader {
        format: AVEX_FORMAT.to_string(),
        version: AVEX_FORMAT_VERSION.to_string(),
        kdf: AvexKdf { kdf_type: AVEX_KDF_TYPE.to_string(), salt, params: AVEX_KDF_PARAMS },
        encryption: AvexEncryption { algorithm: AVEX_ENCRYPTION_ALGORITHM.to_string(), encrypted_data_offset: 0 },
        metadata: AvexMetadata { exported_at: exported_at.to_string(), app_version: Some(app_version.to_string()) },
    };

    // The header records the payload offset, which changes the header length: repeat until the offset is stable.
    let mut header_json = serde_json::to_string_pretty(&header)?;
    loop {
        let offset = (header_json.len() + AVEX_HEADER_DELIMITER.len()) as u64;
        if offset == header.encryption.encrypted_data_offset {
            break;
        }
        header.encryption.encrypted_data_offset = offset;
        header_json = serde_json::to_string_pretty(&header)?;
    }

    let mut file = Vec::with_capacity(header_json.len() + AVEX_HEADER_DELIMITER.len() + payload.len());
    file.extend_from_slice(header_json.as_bytes());
    file.extend_from_slice(AVEX_HEADER_DELIMITER.as_bytes());
    file.extend_from_slice(&payload);
    Ok(file)
}

/// Read and check the header of an .avex file.
pub fn avex_parse_header(avex: &[u8]) -> Result<AvexHeader, AvexError> {
    split(avex).map(|(header, _)| header)
}

/// Decrypt an .avex file into its .avux bytes.
pub fn avex_decrypt(avex: &[u8], password: &str) -> Result<Zeroizing<Vec<u8>>, AvexError> {
    let (header, payload) = split(avex)?;
    let key = derive_key(password, &header.kdf.salt, header.kdf.params).map_err(|e| AvexError::InvalidFile(e.to_string()))?;
    aes_gcm::decrypt(payload, &key, &[]).map(Zeroizing::new).map_err(|_| AvexError::Decryption)
}

/// The checked header and the encrypted payload.
fn split(avex: &[u8]) -> Result<(AvexHeader, &[u8]), AvexError> {
    let delimiter = AVEX_HEADER_DELIMITER.as_bytes();
    let index = avex.windows(delimiter.len()).position(|window| window == delimiter).ok_or_else(|| AvexError::InvalidFile("header delimiter not found".to_string()))?;
    let header: AvexHeader = serde_json::from_slice(&avex[..index]).map_err(|e| AvexError::InvalidFile(e.to_string()))?;

    if header.format != AVEX_FORMAT {
        return Err(AvexError::InvalidFile(format!("expected format '{}', got '{}'", AVEX_FORMAT, header.format)));
    }
    if header.version != AVEX_FORMAT_VERSION {
        return Err(AvexError::InvalidFile(format!("unsupported version {}, expected {}", header.version, AVEX_FORMAT_VERSION)));
    }
    if !header.kdf.kdf_type.eq_ignore_ascii_case(AVEX_KDF_TYPE) {
        return Err(AvexError::InvalidFile(format!("unsupported KDF type {}, only Argon2id is supported", header.kdf.kdf_type)));
    }

    Ok((header, &avex[index + delimiter.len()..]))
}

/// The base64 AES key derived from the password; the salt is hashed as the characters of its base64 string.
fn derive_key(password: &str, salt: &str, params: AvexKdfParams) -> Result<Zeroizing<String>, Argon2Error> {
    let params = Argon2Params { memory_kib: params.memory_size, iterations: params.iterations, parallelism: params.degree_of_parallelism };
    let key = argon2_derive_key(password.as_bytes(), salt.as_bytes(), params)?;
    Ok(Zeroizing::new(base64_encode(&key)))
}
