use crate::crypto::{self, aad};
use crate::vault_codec;
use crate::vault_sync::blob_keys::*;

const MANIFEST: &str = "0a1b2c3d-0000-0000-0000-000000000001";
const SALT: &str = "5a17";

/// The address of `bytes` in a manifest salted with [`SALT`].
fn address(bytes: &[u8]) -> String {
    vault_codec::salted_blob_hash(bytes, SALT).unwrap()
}

#[test]
fn a_blob_opens_with_the_vek_through_its_own_key() {
    let vek = crypto::aes_gcm::generate_key();
    let hash = address(&[1, 2, 3, 4]);
    let blob = encrypt_blob(&[1, 2, 3, 4], &vek, MANIFEST, &hash).unwrap();

    assert_eq!(decrypt_blob(&blob, &vek, MANIFEST, SALT, &hash).unwrap(), vec![1, 2, 3, 4]);
    assert!(crypto::aes_gcm::decrypt(&blob.encrypted_data, &vek, &[]).is_err(), "the bytes are not encrypted with the VEK itself");
    assert!(decrypt_blob(&blob, &crypto::aes_gcm::generate_key(), MANIFEST, SALT, &hash).is_err());
}

#[test]
fn a_blob_does_not_open_at_another_address() {
    let vek = crypto::aes_gcm::generate_key();
    let (hash, other_hash) = (address(&[1, 2, 3, 4]), address(&[5, 6]));
    let blob = encrypt_blob(&[1, 2, 3, 4], &vek, MANIFEST, &hash).unwrap();
    assert!(decrypt_blob(&blob, &vek, MANIFEST, SALT, &other_hash).is_err(), "served under another hash");
    assert!(decrypt_blob(&blob, &vek, "0a1b2c3d-0000-0000-0000-000000000002", SALT, &hash).is_err(), "served under another manifest");

    // The blob key of one blob next to the bytes of another: neither half opens the other.
    let other = encrypt_blob(&[5, 6], &vek, MANIFEST, &other_hash).unwrap();
    let mixed = EncryptedBlob { encrypted_data: other.encrypted_data, encrypted_blob_key: blob.encrypted_blob_key };
    assert!(decrypt_blob(&mixed, &vek, MANIFEST, SALT, &hash).is_err());
}

#[test]
fn a_blob_whose_bytes_do_not_hash_to_its_address_is_refused() {
    // A writer holding the VEK can encrypt any bytes under any address; the address must still match the content.
    let vek = crypto::aes_gcm::generate_key();
    let hash = address(&[1, 2, 3, 4]);
    let forged = encrypt_blob(&[5, 6], &vek, MANIFEST, &hash).unwrap();

    assert!(decrypt_blob(&forged, &vek, MANIFEST, SALT, &hash).is_err());
    assert!(decrypt_blob(&encrypt_blob(&[1, 2, 3, 4], &vek, MANIFEST, &hash).unwrap(), &vek, MANIFEST, "5a18", &hash).is_err(), "hashed with another manifest's salt");
}

#[test]
fn changing_the_vek_only_encrypts_the_blob_key_again() {
    let (old_vek, new_vek) = (crypto::aes_gcm::generate_key(), crypto::aes_gcm::generate_key());
    let hash = address(&[9; 64]);
    let blob = encrypt_blob(&[9; 64], &old_vek, MANIFEST, &hash).unwrap();

    let key_aad = aad::blob_key(MANIFEST, &hash);
    let blob_key = crypto::decrypt_key(&blob.encrypted_blob_key, &old_vek, &key_aad).unwrap();
    let rekeyed = EncryptedBlob { encrypted_data: blob.encrypted_data.clone(), encrypted_blob_key: crypto::encrypt_key(&blob_key, &new_vek, &key_aad).unwrap() };

    assert_eq!(decrypt_blob(&rekeyed, &new_vek, MANIFEST, SALT, &hash).unwrap(), vec![9; 64]);
    assert!(decrypt_blob(&rekeyed, &old_vek, MANIFEST, SALT, &hash).is_err());
}

#[test]
fn a_cached_blob_reads_back_as_it_was_written() {
    let blob = encrypt_blob(&[5], &crypto::aes_gcm::generate_key(), MANIFEST, &address(&[5])).unwrap();
    let read: EncryptedBlob = serde_json::from_value(serde_json::to_value(&blob).unwrap()).unwrap();
    assert_eq!(read, blob);
}
