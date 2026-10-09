//! The WebAuthn authenticator for key generation, authenticator data, the attestation
//! object, assertion signatures and the PRF extension.

mod cbor;
mod keys;

#[cfg(test)]
mod tests;

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

use crate::common::encoding::format_uuid;
use crate::common::error::{VaultError, VaultResult};

/// COSE algorithm identifier of ES256 (ECDSA P-256 with SHA-256).
pub const ALG_ES256: i64 = -7;

/// COSE algorithm identifier of RS256 (RSASSA-PKCS1-v1.5 with SHA-256).
pub const ALG_RS256: i64 = -257;

/// The algorithms this authenticator supports, in its own order of preference.
const SUPPORTED_ALGORITHMS: [i64; 2] = [ALG_ES256, ALG_RS256];

/// AliasVault's AAGUID: a11a5faa-9f32-4b8c-8c5d-2f7d13e8c942.
const AAGUID: [u8; 16] = [0xa1, 0x1a, 0x5f, 0xaa, 0x9f, 0x32, 0x4b, 0x8c, 0x8c, 0x5d, 0x2f, 0x7d, 0x13, 0xe8, 0xc9, 0x42];

const FLAG_UP: u8 = 0x01;
const FLAG_UV: u8 = 0x04;
const FLAG_BE: u8 = 0x08;
const FLAG_BS: u8 = 0x10;
const FLAG_AT: u8 = 0x40;

/// The salts of a PRF extension request.
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PasskeyPrfInputs {
    pub first: Option<Vec<u8>>,
    pub second: Option<Vec<u8>>,
}

/// The PRF outputs for the requested salts.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PasskeyPrfResults {
    pub first: Vec<u8>,
    pub second: Option<Vec<u8>>,
}

/// A new passkey: what the relying party receives, and the keys and PRF secret the vault stores.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PasskeyCreation {
    pub attestation_object: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub public_key_jwk: String,
    /// The public key as DER SubjectPublicKeyInfo.
    pub public_key_spki: Vec<u8>,
    pub private_key_jwk: String,
    pub prf_secret: Option<Vec<u8>>,
    pub prf_results: Option<PasskeyPrfResults>,
}

/// A signed assertion for the relying party.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PasskeyAssertion {
    pub authenticator_data: Vec<u8>,
    pub signature: Vec<u8>,
    pub prf_results: Option<PasskeyPrfResults>,
}

/// The first algorithm in the relying party's preference order that this authenticator supports; ES256 when it lists none.
pub fn pick_algorithm(requested: &[i64]) -> VaultResult<i64> {
    if requested.is_empty() {
        return Ok(ALG_ES256);
    }
    requested.iter().copied().find(|alg| SUPPORTED_ALGORITHMS.contains(alg)).ok_or_else(|| VaultError::General("No supported algorithm (ES256, RS256) in pubKeyCredParams".to_string()))
}

/// Create a passkey for `rp_id`: a fresh key pair, the attestation object, and a PRF secret when `enable_prf` is set.
/// With `self_attestation_client_data_hash` the attestation is "packed" self-attestation over that hash, otherwise "none".
pub fn create_passkey(
    credential_id: &[u8],
    rp_id: &str,
    algorithm: i64,
    uv_performed: bool,
    enable_prf: bool,
    prf_inputs: Option<&PasskeyPrfInputs>,
    self_attestation_client_data_hash: Option<&[u8]>,
) -> VaultResult<PasskeyCreation> {
    let credential_id_length = u16::try_from(credential_id.len()).map_err(|_| VaultError::General("Credential id is too long".to_string()))?;
    let key = keys::generate(algorithm)?;

    let mut authenticator_data = authenticator_data(rp_id, FLAG_AT, uv_performed);
    authenticator_data.extend_from_slice(&AAGUID);
    authenticator_data.extend_from_slice(&credential_id_length.to_be_bytes());
    authenticator_data.extend_from_slice(credential_id);
    authenticator_data.extend_from_slice(&key.cose_public_key);

    let (fmt, statement) = match self_attestation_client_data_hash {
        Some(client_data_hash) => {
            let signature = keys::sign(&key.private_key_jwk, &[authenticator_data.as_slice(), client_data_hash].concat())?;
            ("packed", cbor::map(&[(cbor::text("alg"), cbor::int(algorithm)), (cbor::text("sig"), cbor::bytes(&signature))]))
        }
        None => ("none", cbor::map(&[])),
    };
    let attestation_object = cbor::map(&[(cbor::text("fmt"), cbor::text(fmt)), (cbor::text("attStmt"), statement), (cbor::text("authData"), cbor::bytes(&authenticator_data))]);

    let prf_secret = enable_prf.then(|| {
        let mut secret = vec![0u8; 32];
        crate::common::rng::fill_random(&mut secret);
        secret
    });
    let prf_results = prf(prf_secret.as_deref(), prf_inputs);

    Ok(PasskeyCreation { attestation_object, authenticator_data, public_key_jwk: key.public_key_jwk, public_key_spki: key.public_key_spki, private_key_jwk: key.private_key_jwk, prf_secret, prf_results })
}

/// Sign an assertion for `rp_id` over `authenticator_data || client_data_hash` with a stored private key.
pub fn get_assertion(rp_id: &str, client_data_hash: &[u8], private_key_jwk: &str, uv_performed: bool, prf_inputs: Option<&PasskeyPrfInputs>, prf_secret: Option<&[u8]>) -> VaultResult<PasskeyAssertion> {
    let authenticator_data = authenticator_data(rp_id, 0, uv_performed);
    let mut signed = authenticator_data.clone();
    signed.extend_from_slice(client_data_hash);
    let signature = keys::sign(private_key_jwk, &signed)?;
    Ok(PasskeyAssertion { authenticator_data, signature, prf_results: prf(prf_secret, prf_inputs) })
}

/// The 16 bytes of a credential id from its GUID text.
pub fn guid_to_bytes(guid: &str) -> VaultResult<Vec<u8>> {
    let hex: String = guid.chars().filter(|c| *c != '-').collect();
    match crate::common::encoding::hex_decode(&hex) {
        Some(bytes) if bytes.len() == 16 => Ok(bytes),
        _ => Err(VaultError::General(format!("Invalid GUID \"{guid}\""))),
    }
}

/// The lowercase GUID text of a 16-byte credential id.
pub fn bytes_to_guid(bytes: &[u8]) -> VaultResult<String> {
    let bytes: [u8; 16] = bytes.try_into().map_err(|_| VaultError::General(format!("A credential id GUID is 16 bytes, not {}", bytes.len())))?;
    Ok(format_uuid(&bytes))
}

/// The authenticator data header: SHA-256(rpId), flags, and a zero sign count.
fn authenticator_data(rp_id: &str, extra_flags: u8, uv_performed: bool) -> Vec<u8> {
    let mut flags = FLAG_UP | FLAG_BE | FLAG_BS | extra_flags;
    if uv_performed {
        flags |= FLAG_UV;
    }
    let mut data = Sha256::digest(rp_id.as_bytes()).to_vec();
    data.push(flags);
    data.extend_from_slice(&[0, 0, 0, 0]);
    data
}

/// The PRF outputs for the requested salts, or None without both a secret and a first salt.
fn prf(secret: Option<&[u8]>, inputs: Option<&PasskeyPrfInputs>) -> Option<PasskeyPrfResults> {
    let (secret, inputs) = (secret?, inputs?);
    Some(PasskeyPrfResults { first: evaluate_prf(secret, inputs.first.as_deref()?), second: inputs.second.as_deref().map(|salt| evaluate_prf(secret, salt)) })
}

/// HMAC-SHA256(secret, SHA-256("WebAuthn PRF" || 0x00 || salt)), the WebAuthn PRF extension over hmac-secret.
fn evaluate_prf(secret: &[u8], salt: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"WebAuthn PRF\0");
    hasher.update(salt);
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).expect("HMAC takes a key of any length");
    mac.update(&hasher.finalize());
    mac.finalize().into_bytes().to_vec()
}
