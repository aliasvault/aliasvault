use crate::crypto::{self, aad};
use crate::vault_sync::blob_keys::*;

const MANIFEST: &str = "0a1b2c3d-0000-0000-0000-000000000001";
const HASH: &str = "aa11";

#[test]
fn a_blob_opens_with_the_vek_through_its_own_key() {
    let vek = crypto::generate_key_base64();
    let blob = encrypt_blob(&[1, 2, 3, 4], &vek, MANIFEST, HASH).unwrap();

    assert_eq!(decrypt_blob(&blob, &vek, MANIFEST, HASH).unwrap(), vec![1, 2, 3, 4]);
    assert!(crypto::symmetric_decrypt_bytes(&blob.encrypted_data, &vek).is_err(), "the bytes are not encrypted with the VEK itself");
    assert!(decrypt_blob(&blob, &crypto::generate_key_base64(), MANIFEST, HASH).is_err());
}

#[test]
fn a_blob_does_not_open_at_another_address() {
    let vek = crypto::generate_key_base64();
    let blob = encrypt_blob(&[1, 2, 3, 4], &vek, MANIFEST, HASH).unwrap();
    assert!(decrypt_blob(&blob, &vek, MANIFEST, "bb22").is_err(), "served under another hash");
    assert!(decrypt_blob(&blob, &vek, "0a1b2c3d-0000-0000-0000-000000000002", HASH).is_err(), "served under another manifest");

    // The blob key of one blob next to the bytes of another: neither half opens the other.
    let other = encrypt_blob(&[5, 6], &vek, MANIFEST, "bb22").unwrap();
    let mixed = EncryptedBlob { encrypted_data: other.encrypted_data, encrypted_blob_key: blob.encrypted_blob_key };
    assert!(decrypt_blob(&mixed, &vek, MANIFEST, HASH).is_err());
}

#[test]
fn changing_the_vek_only_encrypts_the_blob_key_again() {
    let (old_vek, new_vek) = (crypto::generate_key_base64(), crypto::generate_key_base64());
    let blob = encrypt_blob(&[9; 64], &old_vek, MANIFEST, HASH).unwrap();

    let key_aad = aad::blob_key(MANIFEST, HASH);
    let blob_key = crypto::unwrap_key(&blob.encrypted_blob_key, &old_vek, &key_aad).unwrap();
    let rekeyed = EncryptedBlob { encrypted_data: blob.encrypted_data.clone(), encrypted_blob_key: crypto::wrap_key(&blob_key, &new_vek, &key_aad).unwrap() };

    assert_eq!(decrypt_blob(&rekeyed, &new_vek, MANIFEST, HASH).unwrap(), vec![9; 64]);
    assert!(decrypt_blob(&rekeyed, &old_vek, MANIFEST, HASH).is_err());
}

#[test]
fn a_cached_blob_reads_back_as_it_was_written() {
    let blob = encrypt_blob(&[5], &crypto::generate_key_base64(), MANIFEST, HASH).unwrap();
    let read: EncryptedBlob = serde_json::from_value(serde_json::to_value(&blob).unwrap()).unwrap();
    assert_eq!(read, blob);
}
