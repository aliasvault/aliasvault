//! SRP-6a (Secure Remote Password), client side only; the server side lives in the .NET API.
//!
//! Uses RustCrypto `srp` crate for most operations, except certain places
//! where the format must stay compatible with the `SecureRemotePassword` .NET package used by the API server.

use num_bigint::BigUint;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use srp::client::SrpClient;
use srp::groups::G_2048;
use srp::utils::{compute_k, compute_u};
use subtle::ConstantTimeEq;
use thiserror::Error;
use zeroize::{Zeroize, Zeroizing};

use crate::common::encoding::{hex_decode, hex_encode_upper as bytes_to_hex};
use crate::common::rng::random_bytes;

/// Byte length of the 2048-bit group modulus N; all padded values use this size.
pub(super) const N_BYTES: usize = 256;

/// SRP ephemeral key pair (public and secret values).
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SrpEphemeral {
    pub public: String,
    pub secret: String,
}

/// SRP session containing proof and shared key.
#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SrpSession {
    pub proof: String,
    pub key: String,
}

impl fmt::Debug for SrpEphemeral {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SrpEphemeral").field("public", &self.public).field("secret", &"<redacted>").finish()
    }
}

impl fmt::Debug for SrpSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SrpSession").field("proof", &self.proof).field("key", &"<redacted>").finish()
    }
}

/// SRP-related errors.
#[derive(Error, Debug, Clone)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
#[cfg_attr(feature = "uniffi", uniffi(flat_error))]
pub enum SrpError {
    #[error("Invalid hex string: {0}")]
    InvalidHex(String),
    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
    #[error("Authentication failed: {0}")]
    AuthenticationFailed(String),
}

/// Decode a hex parameter (either case, optional 0x prefix).
pub(super) fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, SrpError> {
    let hex = hex.trim();
    let hex = hex.strip_prefix("0x").or_else(|| hex.strip_prefix("0X")).unwrap_or(hex);
    if hex.is_empty() {
        return Err(SrpError::InvalidHex("empty hex string".to_string()));
    }
    hex_decode(hex).ok_or_else(|| SrpError::InvalidHex(format!("malformed hex string of length {}", hex.len())))
}

/// Left-pad bytes with zeros to a specific length.
pub(super) fn pad_to_length(mut bytes: Vec<u8>, target_len: usize) -> Vec<u8> {
    if bytes.len() >= target_len {
        bytes
    } else {
        let mut padded = vec![0u8; target_len - bytes.len()];
        padded.extend_from_slice(&bytes);
        bytes.zeroize();
        padded
    }
}

/// Convert a BigUint to big-endian bytes left-padded to the group size (256 bytes).
pub(super) fn to_padded_bytes(value: &BigUint) -> Vec<u8> {
    pad_to_length(value.to_bytes_be(), N_BYTES)
}

/// A random 32-byte SRP salt as an uppercase hex string.
pub fn srp_generate_salt() -> String {
    bytes_to_hex(&random_bytes(32))
}

/// The SRP private key `x = H(salt | H(identity | ":" | password_hash))` as uppercase hex, from hex inputs.
/// The full 32-byte digest is returned (not via BigUint, which would strip leading zero bytes).
pub fn srp_derive_private_key(salt: &str, identity: &str, password_hash: &str) -> Result<String, SrpError> {
    let identity = identity.to_lowercase();
    let salt_bytes = hex_to_bytes(salt)?;

    let identity_hash = SrpClient::<Sha256>::compute_identity_hash(identity.as_bytes(), password_hash.as_bytes());

    let mut x_hasher = Sha256::new();
    x_hasher.update(&salt_bytes);
    x_hasher.update(identity_hash);

    Ok(bytes_to_hex(&x_hasher.finalize()))
}

/// The SRP verifier `v = g^x mod N` as uppercase hex (256 bytes), from the hex private key.
pub fn srp_derive_verifier(private_key: &str) -> Result<String, SrpError> {
    let x = BigUint::from_bytes_be(&Zeroizing::new(hex_to_bytes(private_key)?));

    let client = SrpClient::<Sha256>::new(&G_2048);
    let v = client.compute_v(&x);

    Ok(bytes_to_hex(&to_padded_bytes(&v)))
}

/// A client ephemeral pair: `A = g^a mod N` for a random 64-byte secret `a`.
pub fn srp_generate_ephemeral() -> SrpEphemeral {
    let client = SrpClient::<Sha256>::new(&G_2048);

    let a = Zeroizing::new(random_bytes(64));
    let a_pub = client.compute_public_ephemeral(&a);

    SrpEphemeral { public: bytes_to_hex(&pad_to_length(a_pub, N_BYTES)), secret: bytes_to_hex(&a) }
}

/// The client session (key `K` and proof `M1`) from the server's public ephemeral `B`; hex in, hex out.
pub fn srp_derive_session(client_secret: &str, server_public: &str, salt: &str, identity: &str, private_key: &str) -> Result<SrpSession, SrpError> {
    let identity = identity.to_lowercase();
    let a = BigUint::from_bytes_be(&Zeroizing::new(hex_to_bytes(client_secret)?));
    let b_pub = BigUint::from_bytes_be(&hex_to_bytes(server_public)?);
    let salt_bytes = hex_to_bytes(salt)?;
    let x = BigUint::from_bytes_be(&Zeroizing::new(hex_to_bytes(private_key)?));

    // Safeguard against malicious B (B mod N must not be 0)
    if &b_pub % &G_2048.n == BigUint::default() {
        return Err(SrpError::InvalidParameter("server public ephemeral is invalid".to_string()));
    }

    let client = SrpClient::<Sha256>::new(&G_2048);
    let a_pub = client.compute_a_pub(&a);

    let a_pub_bytes = to_padded_bytes(&a_pub);
    let b_pub_bytes = to_padded_bytes(&b_pub);

    let u = compute_u::<Sha256>(&a_pub_bytes, &b_pub_bytes);
    if u == BigUint::default() {
        return Err(SrpError::InvalidParameter("scrambling parameter u is zero".to_string()));
    }
    let k = compute_k::<Sha256>(&G_2048);

    // S = (B - k*g^x)^(a + u*x) mod N
    let s = client.compute_premaster_secret(&b_pub, &k, &x, &a, &u);

    let key = derive_session_key(&s);
    let m1 = compute_m1(&a_pub_bytes, &b_pub_bytes, &salt_bytes, &identity, &key);

    Ok(SrpSession { proof: bytes_to_hex(&m1), key: bytes_to_hex(&key) })
}

/// Whether the server's proof `M2` matches, which confirms it derived the same session key.
pub fn srp_verify_session(client_public: &str, client_proof: &str, session_key: &str, server_proof: &str) -> Result<bool, SrpError> {
    let a_pub_bytes = hex_to_bytes(client_public)?;
    let m1_bytes = hex_to_bytes(client_proof)?;
    let key_bytes = Zeroizing::new(hex_to_bytes(session_key)?);
    let server_m2_bytes = hex_to_bytes(server_proof)?;

    let expected_m2 = compute_m2(&a_pub_bytes, &m1_bytes, &key_bytes);

    Ok(expected_m2.ct_eq(&server_m2_bytes).unwrap_u8() == 1)
}

/*
 * Wire format primitives that deviate from the `srp` crate on purpose: the SecureRemotePassword (.NET) format hashes
 * the padded premaster secret into K and uses the RFC 2945 M1, while the crate uses raw S and M1 = H(A|B|S).
 */

/// Derive the session key K = H(PAD(S)) from the premaster secret.
pub(super) fn derive_session_key(s: &BigUint) -> Zeroizing<Vec<u8>> {
    let padded = Zeroizing::new(to_padded_bytes(s));
    Zeroizing::new(Sha256::digest(&*padded).to_vec())
}

/// Compute M1 = H(H(N) XOR H(g) | H(I) | s | A | B | K)
///
/// Note: H(g) uses g without padding, unlike k = H(N, PAD(g))
pub(super) fn compute_m1(a_pub: &[u8], b_pub: &[u8], salt: &[u8], identity: &str, key: &[u8]) -> Vec<u8> {
    let h_n = Sha256::digest(G_2048.n.to_bytes_be());
    let h_g = Sha256::digest(G_2048.g.to_bytes_be());
    let h_n_xor_h_g: Vec<u8> = h_n.iter().zip(h_g.iter()).map(|(a, b)| a ^ b).collect();

    let h_i = Sha256::digest(identity.as_bytes());

    let mut hasher = Sha256::new();
    hasher.update(&h_n_xor_h_g);
    hasher.update(h_i);
    hasher.update(salt);
    hasher.update(a_pub);
    hasher.update(b_pub);
    hasher.update(key);
    hasher.finalize().to_vec()
}

/// Compute M2 = H(A | M1 | K)
pub(super) fn compute_m2(a_pub: &[u8], m1: &[u8], key: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(a_pub);
    hasher.update(m1);
    hasher.update(key);
    hasher.finalize().to_vec()
}
