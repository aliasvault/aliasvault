//! Blob keys: every blob is encrypted with a random key of its own which is then encrypted with the manifest's VEK.

use serde::{Deserialize, Serialize};

use crate::crypto::{self, aad};
use crate::common::encoding::{base64_decode, base64_encode};
use crate::common::error::VaultResult;

/// A blob as the server stores it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncryptedBlob {
    /// The bytes, encrypted with the blob key. Persisted as base64 under the old field name, so existing caches still read.
    #[serde(rename = "encryptedDataBase64", with = "base64_bytes")]
    pub encrypted_data: Vec<u8>,
    /// The blob key, encrypted with the manifest's VEK.
    pub encrypted_blob_key: String,
}

/// Encrypt blob bytes with a fresh blob key, and that key with the manifest's VEK, both bound to the blob's address.
pub(crate) fn encrypt_blob(bytes: &[u8], vek: &str, manifest_id: &str, hash: &str) -> VaultResult<EncryptedBlob> {
    let blob_key = zeroize::Zeroizing::new(crypto::generate_key_base64());
    Ok(EncryptedBlob {
        encrypted_data: crypto::symmetric_encrypt_raw_with_aad(bytes, &blob_key, &aad::blob_data(manifest_id, hash))?,
        encrypted_blob_key: crypto::encrypt_key(&blob_key, vek, &aad::blob_key(manifest_id, hash))?,
    })
}

/// Decrypt the blob stored at `(manifest_id, hash)` with the manifest's VEK.
pub(crate) fn decrypt_blob(blob: &EncryptedBlob, vek: &str, manifest_id: &str, hash: &str) -> VaultResult<Vec<u8>> {
    let blob_key = crypto::decrypt_key(&blob.encrypted_blob_key, vek, &aad::blob_key(manifest_id, hash))?;
    crypto::symmetric_decrypt_bytes_with_aad(&blob.encrypted_data, &blob_key, &aad::blob_data(manifest_id, hash))
}

/// Serde for bytes stored as a standard base64 string.
mod base64_bytes {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&super::base64_encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        super::base64_decode(&String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}
