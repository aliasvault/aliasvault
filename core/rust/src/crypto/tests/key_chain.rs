use crate::common::encoding::hex_encode_upper;
use crate::crypto::aad;
use crate::crypto::aes_gcm::{decrypt_text, generate_key};
use crate::crypto::key_chain::*;
use crate::crypto::signing;
use crate::crypto::tokens::{ENCRYPTION_TYPE_ARGON2ID, ENCRYPTION_TYPE_ARGON2ID_HKDF};

/// HKDF-SHA256(ikm = 0x00..0x1f, salt = none, info = "AliasVault KEK v1", L = 32).
const KEK_VECTOR: &str = "8103CACFCD107162AECCFAEDB26426F53FF28C5D4273D2440641A5FA3ADD39D2";

/// HKDF-SHA256(ikm = 0x00..0x1f, salt = none, info = "AliasVault SRP v1", L = 32).
const SRP_VECTOR: &str = "BC09E255E5425823B7347FD803F4C5DCE8F11A7BC23B6F78FCC3D6D87240D923";

/// Known-answer vector: every host derives the KEK through this one function, and a changed output means no stored
/// Account Key opens any more. Never regenerate it.
#[test]
fn derive_kek_known_answer() {
    let unlock_key: Vec<u8> = (0u8..32).collect();
    assert_eq!(hex_encode_upper(&derive_kek(&unlock_key)), KEK_VECTOR);
}

/// Known-answer vector for the SRP input of an `Argon2IdHkdf` account: a changed output means no upgraded verifier
/// matches any more. Never regenerate it.
#[test]
fn derive_srp_password_hash_known_answer() {
    let unlock_key: Vec<u8> = (0u8..32).collect();
    assert_eq!(*derive_srp_password_hash(&unlock_key, ENCRYPTION_TYPE_ARGON2ID_HKDF).unwrap(), SRP_VECTOR);
    assert_eq!(*derive_srp_password_hash(&unlock_key, ENCRYPTION_TYPE_ARGON2ID).unwrap(), hex_encode_upper(&unlock_key));
}

#[test]
fn srp_input_and_kek_are_separate() {
    let unlock_key: Vec<u8> = (0u8..32).collect();
    let srp = derive_srp_password_hash(&unlock_key, ENCRYPTION_TYPE_ARGON2ID_HKDF).unwrap();
    assert_ne!(*srp, hex_encode_upper(&derive_kek(&unlock_key)));
    assert!(matches!(derive_srp_password_hash(&unlock_key, "Scrypt"), Err(SrpInputError::UnsupportedEncryptionType(_))));
}

#[test]
fn kek_differs_from_the_unlock_key() {
    let unlock_key = generate_key();
    assert_ne!(*derive_kek_base64(&unlock_key).unwrap(), *unlock_key);
}

#[test]
fn account_key_is_not_encrypted_with_the_raw_unlock_key() {
    let unlock_key = generate_key();
    let hierarchy = create_account_key_hierarchy(&unlock_key).unwrap();
    assert!(decrypt_key(&hierarchy.account_keys.encrypted_account_key, &unlock_key, aad::ACCOUNT_KEY).is_err());
    assert!(decrypt_key(&hierarchy.account_keys.encrypted_account_key, &derive_kek_base64(&unlock_key).unwrap(), aad::ACCOUNT_KEY).is_ok());
}

#[test]
fn chain_opens_with_the_unlock_key_and_then_with_the_account_key_it_gave() {
    let unlock_key = generate_key();
    let hierarchy = create_account_key_hierarchy(&unlock_key).unwrap();
    let blobs = &hierarchy.account_keys;

    let opened = open_key_chain_with_unlock_key(&unlock_key, &blobs.encrypted_account_key, &blobs.encrypted_vek, Some(&blobs.encrypted_account_private_key)).unwrap();
    assert_eq!(*opened.vault_encryption_key, hierarchy.vault_encryption_key);
    assert_eq!(opened.account_private_key.as_deref().map(String::as_str), Some(hierarchy.account_private_key.as_str()));
    assert_eq!(*opened.account_key, hierarchy.account_key, "a new hierarchy hands the client the Account Key it stores");
    assert_ne!(*opened.account_key, *unlock_key);

    let reopened = open_key_chain_with_account_key(&opened.account_key, &blobs.encrypted_vek, Some(&blobs.encrypted_account_private_key)).unwrap();
    assert_eq!(*reopened.vault_encryption_key, hierarchy.vault_encryption_key);
    assert_eq!(*reopened.account_key, *opened.account_key, "the Account Key is handed back unchanged");
    assert_eq!(reopened.account_private_key, opened.account_private_key);
}

/// Neither function falls back to the other kind of key: a host has to know which key it holds.
#[test]
fn each_open_refuses_the_other_kind_of_key() {
    let unlock_key = generate_key();
    let hierarchy = create_account_key_hierarchy(&unlock_key).unwrap();
    let blobs = &hierarchy.account_keys;
    let account_key = decrypt_account_key(&blobs.encrypted_account_key, &unlock_key).unwrap();

    assert_eq!(open_key_chain_with_account_key(&unlock_key, &blobs.encrypted_vek, None).err(), Some(KeyChainError::AccountKeyRejected));
    assert_eq!(open_key_chain_with_unlock_key(&account_key, &blobs.encrypted_account_key, &blobs.encrypted_vek, None).err(), Some(KeyChainError::UnlockKeyRejected));
}

#[test]
fn chain_rejects_a_wrong_key() {
    let hierarchy = create_account_key_hierarchy(&generate_key()).unwrap();
    let blobs = &hierarchy.account_keys;
    assert_eq!(open_key_chain_with_unlock_key(&generate_key(), &blobs.encrypted_account_key, &blobs.encrypted_vek, None).err(), Some(KeyChainError::UnlockKeyRejected));
    assert_eq!(open_key_chain_with_account_key(&generate_key(), &blobs.encrypted_vek, None).err(), Some(KeyChainError::AccountKeyRejected));
}

#[test]
fn chain_with_a_foreign_vek_is_unreadable_under_the_unlock_key() {
    let unlock_key = generate_key();
    let hierarchy = create_account_key_hierarchy(&unlock_key).unwrap();
    let account_key = decrypt_account_key(&hierarchy.account_keys.encrypted_account_key, &unlock_key).unwrap();
    let foreign_vek = encrypt_key(&generate_key(), &generate_key(), aad::PERSONAL_VEK).unwrap();

    // The Account Key opened, so the unlock key was right: a damaged chain, never a wrong password.
    assert!(matches!(open_key_chain_with_unlock_key(&unlock_key, &hierarchy.account_keys.encrypted_account_key, &foreign_vek, None), Err(KeyChainError::KeyChainUnreadable(_))));
    // With the Account Key alone a wrong key and a damaged chain look the same.
    assert_eq!(open_key_chain_with_account_key(&account_key, &foreign_vek, None).err(), Some(KeyChainError::AccountKeyRejected));
}

#[test]
fn a_private_key_that_does_not_open_leaves_grants_closed_but_opens_the_vault() {
    let unlock_key = generate_key();
    let hierarchy = create_account_key_hierarchy(&unlock_key).unwrap();
    let blobs = &hierarchy.account_keys;
    let account_key = decrypt_account_key(&blobs.encrypted_account_key, &unlock_key).unwrap();

    let opened = open_key_chain_with_account_key(&account_key, &blobs.encrypted_vek, Some(&blobs.encrypted_vek)).unwrap();
    assert_eq!(*opened.vault_encryption_key, hierarchy.vault_encryption_key);
    assert!(opened.account_private_key.is_none());
    assert!(open_key_chain_with_unlock_key(&unlock_key, &blobs.encrypted_account_key, &blobs.encrypted_vek, Some("")).unwrap().account_private_key.is_none());
}

#[test]
fn rotated_keys_open_with_the_new_unlock_key() {
    let old_hierarchy = create_account_key_hierarchy(&generate_key()).unwrap();
    let new_unlock_key = generate_key();

    let rotated = rotate_account_keys(&new_unlock_key).unwrap();
    let blobs = &rotated.account_keys;

    // The new chain opens with the new unlock key and yields the new VEK and private keys.
    let opened = open_key_chain_with_unlock_key(&new_unlock_key, &blobs.encrypted_account_key, &blobs.encrypted_vek, Some(&blobs.encrypted_account_private_key)).unwrap();
    assert_eq!(*opened.vault_encryption_key, rotated.vault_encryption_key);
    assert_eq!(*opened.account_key, rotated.account_key);
    assert_eq!(opened.account_private_key.as_deref().map(String::as_str), Some(rotated.account_private_key.as_str()));
    assert_ne!(rotated.vault_encryption_key, old_hierarchy.vault_encryption_key);
    assert_ne!(blobs.account_public_key, old_hierarchy.account_keys.account_public_key);
    assert_ne!(blobs.signing_public_key, old_hierarchy.account_keys.signing_public_key);

    // The new signing key vouches for the new account public key.
    assert!(signing::verify(&blobs.signing_public_key, &signing::account_public_key_message(&blobs.account_public_key), &blobs.account_public_key_signature));
}

#[test]
fn hierarchy_carries_a_signing_key_that_signed_the_account_public_key() {
    let unlock_key = generate_key();
    let hierarchy = create_account_key_hierarchy(&unlock_key).unwrap();
    let blobs = &hierarchy.account_keys;
    let account_key = decrypt_account_key(&blobs.encrypted_account_key, &unlock_key).unwrap();

    let signing_private_key = open_account_signing_private_key(&blobs.encrypted_signing_private_key, &account_key).unwrap();
    assert_eq!(*signing_private_key, hierarchy.signing_private_key);
    assert_eq!(signing::signing_public_key_of(&signing_private_key).unwrap(), blobs.signing_public_key);

    let message = signing::account_public_key_message(&blobs.account_public_key);
    assert!(signing::verify(&blobs.signing_public_key, &message, &blobs.account_public_key_signature));
    assert!(open_account_private_key(&blobs.encrypted_signing_private_key, &account_key).is_err(), "the signing key does not open in the account private key slot");
}

#[test]
fn reencrypted_account_key_opens_with_the_new_unlock_key_only() {
    let old_unlock_key = generate_key();
    let new_unlock_key = generate_key();
    let hierarchy = create_account_key_hierarchy(&old_unlock_key).unwrap();
    let blobs = &hierarchy.account_keys;

    let reencrypted = reencrypt_account_key(&blobs.encrypted_account_key, &old_unlock_key, &new_unlock_key).unwrap();
    let opened = open_key_chain_with_unlock_key(&new_unlock_key, &reencrypted.new_encrypted_account_key, &blobs.encrypted_vek, None).unwrap();
    assert_eq!(*opened.vault_encryption_key, hierarchy.vault_encryption_key);
    assert_eq!(*opened.account_key, reencrypted.account_key);
    assert_eq!(open_key_chain_with_unlock_key(&old_unlock_key, &reencrypted.new_encrypted_account_key, &blobs.encrypted_vek, None).err(), Some(KeyChainError::UnlockKeyRejected));
}

#[test]
fn reencrypt_rejects_a_wrong_old_unlock_key() {
    let hierarchy = create_account_key_hierarchy(&generate_key()).unwrap();
    let result = reencrypt_account_key(&hierarchy.account_keys.encrypted_account_key, &generate_key(), &generate_key());
    assert_eq!(result.err(), Some(KeyChainError::UnlockKeyRejected));
}

#[test]
fn encrypt_and_decrypt_key_round_trip() {
    let outer = generate_key();
    let key = generate_key();
    assert_eq!(*decrypt_key(&encrypt_key(&key, &outer, b"a").unwrap(), &outer, b"a").unwrap(), *key);
    assert!(decrypt_key(&encrypt_key(&key, &outer, b"a").unwrap(), &outer, b"b").is_err());
}

#[test]
fn chain_ciphertexts_do_not_open_in_each_others_slot() {
    let unlock_key = generate_key();
    let hierarchy = create_account_key_hierarchy(&unlock_key).unwrap();
    let blobs = &hierarchy.account_keys;
    let account_key = decrypt_account_key(&blobs.encrypted_account_key, &unlock_key).unwrap();

    // The encrypted Account Key served as the encrypted VEK: refused, not read as the VEK.
    assert!(matches!(open_key_chain_with_unlock_key(&unlock_key, &blobs.encrypted_account_key, &blobs.encrypted_account_key, None), Err(KeyChainError::KeyChainUnreadable(_))));
    assert_eq!(open_key_chain_with_account_key(&account_key, &blobs.encrypted_account_key, None).err(), Some(KeyChainError::AccountKeyRejected));
    assert!(decrypt_key(&blobs.encrypted_vek, &account_key, aad::ACCOUNT_KEY).is_err());
    assert!(open_account_private_key(&blobs.encrypted_account_private_key, &account_key).is_ok());
    assert!(decrypt_text(&blobs.encrypted_account_private_key, &account_key, aad::PERSONAL_VEK).is_err());
}

#[test]
fn an_account_key_encrypted_under_any_other_label_is_refused() {
    let unlock_key = generate_key();
    let hierarchy = create_account_key_hierarchy(&unlock_key).unwrap();
    let account_key = decrypt_account_key(&hierarchy.account_keys.encrypted_account_key, &unlock_key).unwrap();
    let kek = derive_kek_base64(&unlock_key).unwrap();
    for label in [aad::PERSONAL_VEK, aad::ACCOUNT_PRIVATE_KEY, aad::ACCOUNT_SIGNING_PRIVATE_KEY, aad::MOBILE_LOGIN_ACCOUNT_KEY, aad::MOBILE_LOGIN_PAYLOAD_KEY, b""] {
        let foreign = encrypt_key(&account_key, &kek, label).unwrap();
        let opened = open_key_chain_with_unlock_key(&unlock_key, &foreign, &hierarchy.account_keys.encrypted_vek, None);
        assert_eq!(opened.err(), Some(KeyChainError::UnlockKeyRejected), "label {:?}", String::from_utf8_lossy(label));
    }
}
