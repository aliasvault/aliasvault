//! Blob keys: every blob is encrypted with a random key of its own which is then encrypted with the manifest's VEK.

use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::encoding::base64_decode;
use crate::error::VaultResult;

/// A blob as the server stores it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EncryptedBlob {
    /// Base64 of the bytes, encrypted with the blob key.
    pub encrypted_data_base64: String,
    /// The blob key, encrypted with the manifest's VEK.
    pub encrypted_blob_key: String,
}

/// Encrypt blob bytes with a fresh blob key, and that key with the manifest's VEK.
pub(crate) fn encrypt_blob(bytes: &[u8], vek: &str) -> VaultResult<EncryptedBlob> {
    let blob_key = zeroize::Zeroizing::new(crypto::generate_key_base64());
    Ok(EncryptedBlob { encrypted_data_base64: crypto::symmetric_encrypt_bytes(bytes, &blob_key)?, encrypted_blob_key: crypto::wrap_key(&blob_key, vek)? })
}

/// Decrypt a stored blob with the manifest's VEK.
pub(crate) fn decrypt_blob(blob: &EncryptedBlob, vek: &str) -> VaultResult<Vec<u8>> {
    let blob_key = crypto::unwrap_key(&blob.encrypted_blob_key, vek)?;
    crypto::symmetric_decrypt_bytes(&base64_decode(&blob.encrypted_data_base64)?, &blob_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_blob_opens_with_the_vek_through_its_own_key() {
        let vek = crypto::generate_key_base64();
        let blob = encrypt_blob(&[1, 2, 3, 4], &vek).unwrap();

        assert_eq!(decrypt_blob(&blob, &vek).unwrap(), vec![1, 2, 3, 4]);
        assert!(crypto::symmetric_decrypt_bytes(&base64_decode(&blob.encrypted_data_base64).unwrap(), &vek).is_err(), "the bytes are not encrypted with the VEK itself");
        assert!(decrypt_blob(&blob, &crypto::generate_key_base64()).is_err());
    }

    #[test]
    fn changing_the_vek_only_encrypts_the_blob_key_again() {
        let (old_vek, new_vek) = (crypto::generate_key_base64(), crypto::generate_key_base64());
        let blob = encrypt_blob(&[9; 64], &old_vek).unwrap();

        let blob_key = crypto::unwrap_key(&blob.encrypted_blob_key, &old_vek).unwrap();
        let rekeyed = EncryptedBlob { encrypted_data_base64: blob.encrypted_data_base64.clone(), encrypted_blob_key: crypto::wrap_key(&blob_key, &new_vek).unwrap() };

        assert_eq!(decrypt_blob(&rekeyed, &new_vek).unwrap(), vec![9; 64]);
        assert!(decrypt_blob(&rekeyed, &old_vek).is_err());
    }

    #[test]
    fn a_cached_blob_reads_back_as_it_was_written() {
        let blob = encrypt_blob(&[5], &crypto::generate_key_base64()).unwrap();
        let read: EncryptedBlob = serde_json::from_value(serde_json::to_value(&blob).unwrap()).unwrap();
        assert_eq!(read, blob);
    }
}
