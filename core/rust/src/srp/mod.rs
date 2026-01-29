//! SRP (Secure Remote Password) protocol implementation.
//!
//! # Protocol Parameters
//! - Group: RFC 5054 2048-bit
//! - Hash: SHA-256
//! - Multiplier k: Computed as `k = H(N, PAD(g))`
//! - All values: Uppercase hex strings
//!
//! # Client Operations
//! - `srp_generate_salt()` - Generate a 32-byte cryptographic salt
//! - `srp_derive_private_key()` - Derive private key x = H(salt | H(identity | ":" | password_hash))
//! - `srp_derive_verifier()` - Derive verifier v = g^x mod N
//! - `srp_generate_ephemeral()` - Generate client ephemeral key pair (A, a)
//! - `srp_derive_session()` - Derive session key and proof from server response
//!
//! # Server Operations
//! - `srp_generate_ephemeral_server()` - Generate server ephemeral key pair (B, b)
//! - `srp_derive_session_server()` - Verify client proof and derive session

use digest::Digest;
use num_bigint::BigUint;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use srp::client::SrpClient;
use srp::groups::G_2048;
use srp::server::SrpServer;
use thiserror::Error;

/// SRP ephemeral key pair (public and secret values).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SrpEphemeral {
    /// Public ephemeral value (uppercase hex)
    pub public: String,
    /// Secret ephemeral value (uppercase hex)
    pub secret: String,
}

/// SRP session containing proof and shared key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SrpSession {
    /// Session proof (uppercase hex)
    pub proof: String,
    /// Shared session key (uppercase hex)
    pub key: String,
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

// ═══════════════════════════════════════════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════════════════════════════════════════

/// Convert bytes to uppercase hex string.
fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<String>()
}

/// Convert hex string to bytes.
fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, SrpError> {
    // Handle both uppercase and lowercase hex
    let hex = hex.trim();
    if hex.is_empty() {
        return Err(SrpError::InvalidHex("empty hex string".to_string()));
    }

    // Remove 0x prefix if present
    let hex = hex.strip_prefix("0x").unwrap_or(hex);
    let hex = hex.strip_prefix("0X").unwrap_or(hex);

    if hex.len() % 2 != 0 {
        return Err(SrpError::InvalidHex(format!(
            "odd length hex string: {}",
            hex.len()
        )));
    }

    (0..hex.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&hex[i..i + 2], 16)
                .map_err(|e| SrpError::InvalidHex(format!("invalid hex at position {}: {}", i, e)))
        })
        .collect()
}

/// Generate cryptographically secure random bytes.
fn generate_random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
}

/// Pad a BigUint to a specific length (for SRP compatibility).
fn pad_to_length(bytes: Vec<u8>, target_len: usize) -> Vec<u8> {
    if bytes.len() >= target_len {
        bytes
    } else {
        let mut padded = vec![0u8; target_len - bytes.len()];
        padded.extend(bytes);
        padded
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Argon2 Password Hashing
// ═══════════════════════════════════════════════════════════════════════════════

/// Derive a key from a password using Argon2Id.
///
/// Uses the AliasVault default parameters:
/// - Iterations: 2
/// - Memory: 19456 KiB
/// - Parallelism: 1
/// - Output length: 32 bytes
///
/// # Arguments
/// * `password` - The password to hash
/// * `salt` - Salt as a string (will be UTF-8 encoded)
///
/// # Returns
/// Derived key as uppercase hex string (64 characters = 32 bytes)
pub fn argon2_hash_password(password: &str, salt: &str) -> Result<String, SrpError> {
    use argon2::{Argon2, Algorithm, Version, Params};

    // AliasVault default parameters
    let params = Params::new(
        19456,  // m_cost (memory in KiB)
        2,      // t_cost (iterations)
        1,      // p_cost (parallelism)
        Some(32) // output length
    ).map_err(|e| SrpError::InvalidParameter(format!("Invalid Argon2 params: {}", e)))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut output = [0u8; 32];
    argon2.hash_password_into(
        password.as_bytes(),
        salt.as_bytes(),
        &mut output
    ).map_err(|e| SrpError::InvalidParameter(format!("Argon2 hash failed: {}", e)))?;

    Ok(bytes_to_hex(&output))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Client Operations
// ═══════════════════════════════════════════════════════════════════════════════

/// Generate a cryptographic salt for SRP.
///
/// Returns a 32-byte random salt as an uppercase hex string.
pub fn srp_generate_salt() -> String {
    let salt = generate_random_bytes(32);
    bytes_to_hex(&salt)
}

/// Derive the SRP private key (x) from credentials.
///
/// Formula: x = H(salt | H(identity | ":" | password_hash))
///
/// # Arguments
/// * `salt` - Salt as hex string
/// * `identity` - User identity
/// * `password_hash` - Pre-hashed password as hex string
///
/// # Returns
/// Private key as uppercase hex string
pub fn srp_derive_private_key(
    salt: &str,
    identity: &str,
    password_hash: &str,
) -> Result<String, SrpError> {
    let salt_bytes = hex_to_bytes(salt)?;

    // Compute identity hash: H(identity | ":" | password_hash)
    let mut identity_hasher = Sha256::new();
    identity_hasher.update(identity.as_bytes());
    identity_hasher.update(b":");
    identity_hasher.update(password_hash.as_bytes());
    let identity_hash = identity_hasher.finalize();

    // Compute x = H(salt | identity_hash)
    let mut x_hasher = Sha256::new();
    x_hasher.update(&salt_bytes);
    x_hasher.update(&identity_hash);
    let x = x_hasher.finalize();

    Ok(bytes_to_hex(&x))
}

/// Derive the SRP verifier (v) from a private key.
///
/// Formula: v = g^x mod N
///
/// # Arguments
/// * `private_key` - Private key as hex string
///
/// # Returns
/// Verifier as uppercase hex string (256 bytes)
pub fn srp_derive_verifier(private_key: &str) -> Result<String, SrpError> {
    let x_bytes = hex_to_bytes(private_key)?;
    let x = BigUint::from_bytes_be(&x_bytes);

    // v = g^x mod N
    let v = G_2048.g.modpow(&x, &G_2048.n);

    // Pad to N length (256 bytes for 2048-bit group)
    let v_bytes = pad_to_length(v.to_bytes_be(), 256);
    Ok(bytes_to_hex(&v_bytes))
}

/// Generate a client ephemeral key pair.
///
/// Computes A = g^a mod N where a is a random 64-byte secret.
pub fn srp_generate_ephemeral() -> SrpEphemeral {
    let client = SrpClient::<Sha256>::new(&G_2048);

    // Generate 64 bytes of random data for the secret
    let a = generate_random_bytes(64);

    // Compute public ephemeral A = g^a mod N
    let a_pub = client.compute_public_ephemeral(&a);

    // Pad to N length (256 bytes for 2048-bit group)
    let a_pub_padded = pad_to_length(a_pub, 256);

    SrpEphemeral {
        public: bytes_to_hex(&a_pub_padded),
        secret: bytes_to_hex(&a),
    }
}

/// Derive the client session from server response.
///
/// Computes the shared session key K and client proof M1.
///
/// # Arguments
/// * `client_secret` - Client secret ephemeral (a) as hex string
/// * `server_public` - Server public ephemeral (B) as hex string
/// * `salt` - Salt as hex string
/// * `identity` - User identity
/// * `private_key` - Private key (x) as hex string
///
/// # Returns
/// Session with proof (M1) and key (K), or error if B is invalid
pub fn srp_derive_session(
    client_secret: &str,
    server_public: &str,
    salt: &str,
    identity: &str,
    private_key: &str,
) -> Result<SrpSession, SrpError> {
    let a = hex_to_bytes(client_secret)?;
    let b_pub = hex_to_bytes(server_public)?;
    let salt_bytes = hex_to_bytes(salt)?;
    let x_bytes = hex_to_bytes(private_key)?;

    let client = SrpClient::<Sha256>::new(&G_2048);

    // Convert to BigUint for calculations
    let a_big = BigUint::from_bytes_be(&a);
    let a_pub = client.compute_a_pub(&a_big);
    let b_pub_big = BigUint::from_bytes_be(&b_pub);

    // Check for malicious B (B mod N must not be 0)
    if &b_pub_big % &G_2048.n == BigUint::default() {
        return Err(SrpError::InvalidParameter(
            "server public ephemeral is invalid".to_string(),
        ));
    }

    // Pad A and B to N length for hashing
    let a_pub_bytes = pad_to_length(a_pub.to_bytes_be(), 256);
    let b_pub_bytes = pad_to_length(b_pub, 256);

    // Compute u = H(A | B)
    let u = compute_u(&a_pub_bytes, &b_pub_bytes);

    // Compute k = H(N | g)
    let k = compute_k();

    // x as BigUint
    let x = BigUint::from_bytes_be(&x_bytes);

    // S = (B - k*g^x)^(a + u*x) mod N
    let kg_x = (&k * G_2048.g.modpow(&x, &G_2048.n)) % &G_2048.n;
    let base = ((&G_2048.n + &b_pub_big) - &kg_x) % &G_2048.n;
    let exp = (&u * &x) + &a_big;
    let s = base.modpow(&exp, &G_2048.n);

    // K = H(S)
    let s_bytes = pad_to_length(s.to_bytes_be(), 256);
    let mut key_hasher = Sha256::new();
    key_hasher.update(&s_bytes);
    let key = key_hasher.finalize();

    // M1 = H(H(N) XOR H(g) | H(I) | s | A | B | K)
    let m1 = compute_m1(&a_pub_bytes, &b_pub_bytes, &salt_bytes, identity, &key);

    Ok(SrpSession {
        proof: bytes_to_hex(&m1),
        key: bytes_to_hex(&key),
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Server Operations
// ═══════════════════════════════════════════════════════════════════════════════

/// Generate a server ephemeral key pair.
///
/// Computes B = k*v + g^b mod N where b is a random 64-byte secret.
///
/// # Arguments
/// * `verifier` - Password verifier (v) as hex string
pub fn srp_generate_ephemeral_server(verifier: &str) -> Result<SrpEphemeral, SrpError> {
    let v_bytes = hex_to_bytes(verifier)?;

    let server = SrpServer::<Sha256>::new(&G_2048);

    // Generate 64 bytes of random data for the secret
    let b = generate_random_bytes(64);

    // Compute public ephemeral B = k*v + g^b mod N
    let b_pub = server.compute_public_ephemeral(&b, &v_bytes);

    // Pad to N length (256 bytes for 2048-bit group)
    let b_pub_padded = pad_to_length(b_pub, 256);

    Ok(SrpEphemeral {
        public: bytes_to_hex(&b_pub_padded),
        secret: bytes_to_hex(&b),
    })
}

/// Derive and verify the server session from client response.
///
/// Verifies client proof M1 and computes server proof M2.
///
/// # Arguments
/// * `server_secret` - Server secret ephemeral (b) as hex string
/// * `client_public` - Client public ephemeral (A) as hex string
/// * `salt` - Salt as hex string
/// * `identity` - User identity
/// * `verifier` - Password verifier (v) as hex string
/// * `client_proof` - Client proof (M1) as hex string
///
/// # Returns
/// Session with proof (M2) and key (K) if verification succeeds, None if M1 is invalid
pub fn srp_derive_session_server(
    server_secret: &str,
    client_public: &str,
    salt: &str,
    identity: &str,
    verifier: &str,
    client_proof: &str,
) -> Result<Option<SrpSession>, SrpError> {
    let b = hex_to_bytes(server_secret)?;
    let a_pub = hex_to_bytes(client_public)?;
    let salt_bytes = hex_to_bytes(salt)?;
    let v_bytes = hex_to_bytes(verifier)?;
    let client_m1 = hex_to_bytes(client_proof)?;

    // Convert to BigUint for calculations
    let b_big = BigUint::from_bytes_be(&b);
    let a_pub_big = BigUint::from_bytes_be(&a_pub);
    let v = BigUint::from_bytes_be(&v_bytes);

    // Check for malicious A (A mod N must not be 0)
    if &a_pub_big % &G_2048.n == BigUint::default() {
        return Err(SrpError::InvalidParameter(
            "client public ephemeral is invalid".to_string(),
        ));
    }

    // Compute k = H(N | g)
    let k = compute_k();

    // B = k*v + g^b mod N
    let kv = (&k * &v) % &G_2048.n;
    let b_pub = (&kv + G_2048.g.modpow(&b_big, &G_2048.n)) % &G_2048.n;

    // Pad A and B to N length
    let a_pub_bytes = pad_to_length(a_pub.clone(), 256);
    let b_pub_bytes = pad_to_length(b_pub.to_bytes_be(), 256);

    // Compute u = H(A | B)
    let u = compute_u(&a_pub_bytes, &b_pub_bytes);

    // S = (A * v^u)^b mod N
    let v_u = v.modpow(&u, &G_2048.n);
    let base = (&a_pub_big * &v_u) % &G_2048.n;
    let s = base.modpow(&b_big, &G_2048.n);

    // K = H(S)
    let s_bytes = pad_to_length(s.to_bytes_be(), 256);
    let mut key_hasher = Sha256::new();
    key_hasher.update(&s_bytes);
    let key = key_hasher.finalize();

    // M1 = H(H(N) XOR H(g) | H(I) | s | A | B | K)
    let expected_m1 = compute_m1(&a_pub_bytes, &b_pub_bytes, &salt_bytes, identity, &key);

    // Verify client proof using constant-time comparison
    use subtle::ConstantTimeEq;
    if expected_m1.ct_eq(&client_m1).unwrap_u8() != 1 {
        return Ok(None);
    }

    // M2 = H(A | M1 | K)
    let m2 = compute_m2(&a_pub_bytes, &expected_m1, &key);

    Ok(Some(SrpSession {
        proof: bytes_to_hex(&m2),
        key: bytes_to_hex(&key),
    }))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Internal Helper Functions
// ═══════════════════════════════════════════════════════════════════════════════

/// Compute u = H(A | B)
fn compute_u(a_pub: &[u8], b_pub: &[u8]) -> BigUint {
    let mut hasher = Sha256::new();
    hasher.update(a_pub);
    hasher.update(b_pub);
    BigUint::from_bytes_be(&hasher.finalize())
}

/// Compute k = H(N | PAD(g))
fn compute_k() -> BigUint {
    let mut hasher = Sha256::new();
    hasher.update(&G_2048.n.to_bytes_be());
    // Pad g to the same length as N
    let g_padded = pad_to_length(G_2048.g.to_bytes_be(), 256);
    hasher.update(&g_padded);
    BigUint::from_bytes_be(&hasher.finalize())
}

/// Compute M1 = H(H(N) XOR H(g) | H(I) | s | A | B | K)
///
/// Note: H(g) uses g without padding, unlike k = H(N, PAD(g))
fn compute_m1(a_pub: &[u8], b_pub: &[u8], salt: &[u8], identity: &str, key: &[u8]) -> Vec<u8> {
    // H(N)
    let mut n_hasher = Sha256::new();
    n_hasher.update(&G_2048.n.to_bytes_be());
    let h_n = n_hasher.finalize();

    // H(g) - NOT padded
    let mut g_hasher = Sha256::new();
    g_hasher.update(&G_2048.g.to_bytes_be());
    let h_g = g_hasher.finalize();

    // H(N) XOR H(g)
    let h_n_xor_h_g: Vec<u8> = h_n.iter().zip(h_g.iter()).map(|(a, b)| a ^ b).collect();

    // H(I)
    let mut i_hasher = Sha256::new();
    i_hasher.update(identity.as_bytes());
    let h_i = i_hasher.finalize();

    // M1 = H(H(N) XOR H(g) | H(I) | s | A | B | K)
    let mut m1_hasher = Sha256::new();
    m1_hasher.update(&h_n_xor_h_g);
    m1_hasher.update(&h_i);
    m1_hasher.update(salt);
    m1_hasher.update(a_pub);
    m1_hasher.update(b_pub);
    m1_hasher.update(key);

    m1_hasher.finalize().to_vec()
}

/// Compute M2 = H(A | M1 | K)
fn compute_m2(a_pub: &[u8], m1: &[u8], key: &[u8]) -> Vec<u8> {
    let mut m2_hasher = Sha256::new();
    m2_hasher.update(a_pub);
    m2_hasher.update(m1);
    m2_hasher.update(key);
    m2_hasher.finalize().to_vec()
}

// ═══════════════════════════════════════════════════════════════════════════════
// Client Verification
// ═══════════════════════════════════════════════════════════════════════════════

/// Verify the server's session proof (M2) on the client side.
///
/// This confirms that the server successfully derived the same session key.
///
/// # Arguments
/// * `client_public` - Client public ephemeral (A) as hex string
/// * `client_proof` - Client proof (M1) as hex string
/// * `session_key` - Session key (K) as hex string
/// * `server_proof` - Server proof (M2) as hex string to verify
///
/// # Returns
/// True if verification succeeds, false otherwise
pub fn srp_verify_session(
    client_public: &str,
    client_proof: &str,
    session_key: &str,
    server_proof: &str,
) -> Result<bool, SrpError> {
    let a_pub_bytes = hex_to_bytes(client_public)?;
    let m1_bytes = hex_to_bytes(client_proof)?;
    let key_bytes = hex_to_bytes(session_key)?;
    let server_m2_bytes = hex_to_bytes(server_proof)?;

    // Compute expected M2 = H(A | M1 | K)
    let expected_m2 = compute_m2(&a_pub_bytes, &m1_bytes, &key_bytes);

    // Constant-time comparison for security
    use subtle::ConstantTimeEq;
    Ok(expected_m2.ct_eq(&server_m2_bytes).unwrap_u8() == 1)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_salt() {
        let salt = srp_generate_salt();
        assert_eq!(salt.len(), 64); // 32 bytes = 64 hex chars
        // Should be valid hex
        assert!(hex_to_bytes(&salt).is_ok());
    }

    #[test]
    fn test_derive_private_key() {
        let salt = "0A0B0C0D0E0F10111213141516171819";
        let identity = "testuser";
        let password_hash = "AABBCCDD";

        let private_key = srp_derive_private_key(salt, identity, password_hash).unwrap();
        eprintln!("Rust Private Key: {}", private_key);

        let expected = "ACD81DF26882B20336CF2A8CDE3CABA35BA359805FDFC4567EA7BD74E8302473";

        // Should be 32 bytes = 64 hex chars
        assert_eq!(private_key.len(), 64);
        assert!(hex_to_bytes(&private_key).is_ok());

        // Same inputs should produce same output
        let private_key2 = srp_derive_private_key(salt, identity, password_hash).unwrap();
        assert_eq!(private_key, private_key2);

        assert_eq!(private_key.to_uppercase(), expected);
    }

    #[test]
    fn test_derive_verifier() {
        let salt = "0A0B0C0D0E0F10111213141516171819";
        let identity = "testuser";
        let password_hash = "AABBCCDD";

        let private_key = srp_derive_private_key(salt, identity, password_hash).unwrap();
        let verifier = srp_derive_verifier(&private_key).unwrap();
        eprintln!("Rust Verifier: {}", verifier);

        let expected = "378FAC69B16F469FB21294F7C74429CD288F47E331E8BA02FFD7C36F2914472A9F2A8C69FFEA434C9F78FCA7E7E41CBBF591FFA589460F023EF3A6F7F6B84366458893C52F8A3304E2247C50BDAE13F4463281B8CDCC519DD563A926C93D9A33E08C1DE2EFB6102BD4BFFE97D9DA9A20354393FA041C8C0459D9D11907E11B75DE4F74990CD0364BA3884C697CF548E31707162D033576B96756A9C8B622332AC9631F62D170445CF33A5EF7E1BE82EC949A5F1FD4AAF1767EE861C729E348FD4209F552BEA5A2F059C64985F4DD2495896AE33315F54329192715AB27EA32B0AF56AC8991C9F708260EF3B5D263FA55B6380CDD294F272FFD1DD86116F0C06C";

        // Should be 256 bytes = 512 hex chars (padded to 2048-bit group size)
        assert_eq!(verifier.len(), 512);
        assert!(hex_to_bytes(&verifier).is_ok());

        assert_eq!(verifier.to_uppercase(), expected);
    }

    #[test]
    fn test_generate_ephemeral() {
        let ephemeral = srp_generate_ephemeral();

        // Public should be 256 bytes = 512 hex chars
        assert_eq!(ephemeral.public.len(), 512);
        // Secret should be 64 bytes = 128 hex chars
        assert_eq!(ephemeral.secret.len(), 128);

        // Both should be valid hex
        assert!(hex_to_bytes(&ephemeral.public).is_ok());
        assert!(hex_to_bytes(&ephemeral.secret).is_ok());
    }

    #[test]
    fn test_generate_ephemeral_server() {
        // First derive a verifier
        let salt = srp_generate_salt();
        let private_key = srp_derive_private_key(&salt, "testuser", "PASSWORDHASH").unwrap();
        let verifier = srp_derive_verifier(&private_key).unwrap();

        // Generate server ephemeral
        let ephemeral = srp_generate_ephemeral_server(&verifier).unwrap();

        // Public should be 256 bytes = 512 hex chars
        assert_eq!(ephemeral.public.len(), 512);
        // Secret should be 64 bytes = 128 hex chars
        assert_eq!(ephemeral.secret.len(), 128);
    }

    /// Test with fixed values for deterministic verification.
    #[test]
    fn test_fixed_values() {
        let salt = "0A0B0C0D0E0F101112131415161718191A1B1C1D1E1F202122232425262728292A2B2C2D2E2F303132333435363738393A3B3C3D3E3F";
        let identity = "testuser";
        let password_hash = "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899";

        let expected_private_key = "37D921B103087DDBCFEE50E240DBF5904BBC021BD07391F206CA74BE5430D79B";
        let expected_verifier = "603ABD0F6C5494976B140BBF29D988989FD88654438994959D851C83FC891FA22C81B7CD3B1BBC5472651473183789A4DB5454D530BDEF328DCBA19C112ED266584D8750AEFDCFC0076FD40B3E16773672994C7CB56B4F6CD5FCA47927F9688483937890054D208DDBDD5117F18461B6AD7A279495583B7D99CDC1EB678E9402171F43DC7732549B5A5A3A4A2BF586686887E09D1DED55A7945C20F4DB62915DCF7FD4D7ECED87758B3E19E25CFC668FDB92FCE15E9452DE7F78BDB9BC80DE25882769870E156B2860A169F33045298CEC7700975E3EF4AAE5B41CE6086E2593EDCF2BEA8F3B613258259197C4AE8A67055ED5546C83F6EF035BA788EC63A1AE";

        let private_key = srp_derive_private_key(salt, identity, password_hash).unwrap();
        eprintln!("Rust Private Key: {}", private_key);
        assert_eq!(private_key.to_uppercase(), expected_private_key);

        let verifier = srp_derive_verifier(&private_key).unwrap();
        eprintln!("Rust Verifier: {}", verifier);
        assert_eq!(verifier.to_uppercase(), expected_verifier);
    }

    /// Test session derivation with fixed ephemeral values.
    #[test]
    fn test_session_fixed_values() {
        let salt = "0A0B0C0D0E0F101112131415161718191A1B1C1D1E1F202122232425262728292A2B2C2D2E2F303132333435363738393A3B3C3D3E3F";
        let identity = "testuser";
        let password_hash = "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899";

        let private_key = srp_derive_private_key(salt, identity, password_hash).unwrap();

        let client_secret = "89697cc13c1cea1f44c5f6b3f8f0cb7ce28246c80de10ca5d4976575dbcb0318";
        let server_public = "523d0e314fccaace5ad5007357b07bb2fb2c5f566be0b812cbe4ffa65adc5bdd5cd59d9ca921b7491481d2963733513968e7bea637a733665f8e9fb7a18ba613a03740eed9ea3795489659a486cd87352054ed49f0636bb2605b8d836a459151cb670d35e8377202d9e1569bf88d0c86bd83d303d8775a65867b68fc7f9a9d5d59c76c413cb1b4d33f1d5eb784d1d18a5705800729a5d566548297c3b84ec1077c4546ab3c9b159a6d6c7265cdc784f36f731fa371e14bc506a544713591579d0a6952c2539746963434f0e97a024c0e93701008e4c54b620a9259d071b88c0a4cf102eaa22732ecfcd1fd23a81ee180074db1b5cee1b3e9172f76153f8d46bc";

        let expected_session_key = "AD713F5D8F520B7B9413CDD9EF6D9B5FE37F23A9B62C5E2B90D2291F8C3A9E6F";
        let expected_session_proof = "698D0DA7137A0FC4A55B49525C1312ADCD07788E8CD5FFF5BD195B3C17B6B3DF";

        let session = srp_derive_session(
            client_secret,
            server_public,
            salt,
            identity,
            &private_key,
        ).unwrap();

        eprintln!("Rust Session Key: {}", session.key);
        eprintln!("Rust Session Proof: {}", session.proof);

        assert_eq!(session.key.to_uppercase(), expected_session_key);
        assert_eq!(session.proof.to_uppercase(), expected_session_proof);
    }

    /// Test with realistic 32-byte salt.
    #[test]
    fn test_realistic_salt() {
        let salt = "7c9d6615bfeb06c552c7fbcbfbe7030035a09f058ed7cf7755ca6d3bfa56393c";
        let username = "testuser";
        let password_hash = "ABCD1234567890ABCD1234567890ABCD1234567890ABCD1234567890ABCD1234";

        let expected_private_key = "352C41C945185EDC02EBA1087A02D06A686A194D3542AE174B4F75F340E4E02E";
        let expected_verifier = "8612168CF700A1CBAE568175B1BDD9B93874A9029B2EA34126910EABFE7DCEA57345560AD96754E1C5A5A2272F1C794D7C6A7D5A756FD37EF78170A3162051035D115AA376F85330701586A714C97413F84BAE12A87497357C0483E443B7D3B75B3C19BCF845ABD38956D2EAEFE733DC696D88277245DC7E25C9013D77053F82E9400F6918BF58176D536EB7D90572A645790E6F5660FD0FB8D5673B584F1F33F06C824CA1CF246BED84E228745CD4ABC1184E5057D03191AB9253F86A407970A4578DC6763D7D42AF2CB71C79F60BB71CA16CF98A17E4F3D62BE8396593427487115163B668A8E0069487C763342B58EFAF9499EBB87DE07E52836B3DF4F28C";

        let private_key = srp_derive_private_key(salt, username, password_hash).unwrap();
        eprintln!("Rust Private Key: {}", private_key);
        assert_eq!(private_key.to_uppercase(), expected_private_key);

        let verifier = srp_derive_verifier(&private_key).unwrap();
        eprintln!("Rust Verifier: {}", verifier);
        assert_eq!(verifier.to_uppercase(), expected_verifier);

        // Test session derivation
        let client_secret = "d21695287e680db505882ba699bb1a417fe064cc817ead8f2e872fb4b8612273";
        let server_public = "02ea98a39b29fee876b183124e9dd8f4e5dedf429a1bb0e74dafd67a6a855f8e43a317edb17b93fc6c42c7ed5a2d5cc166fe9dabc66e71475a3a947aec440c23e5c8b347ee4352a84a2fb94d683d1545ef2ac7571e5032d68a0bdfe8cc16d8cf852851dc9a74690d35439a722dc22eaa682ee50eb354131445fd414d4e30dd7653560a4342ffccf392f4b658b37f939a179f01be15aa4364f7d720eebb850a5cad023ce07ed09f47da00ba00ac31df2bb251c2e910a8d50044b9dc926711b648718357da4b233078a17862e5ad57df0cb13325ef39acd42625fd858f0073e073bd61eee07a89be4c2d4b52d868324fea7b68acf3dce94733973469fdc1cc8d32";

        let expected_session_key = "7564C550D5BF148D17B33C251B71EA2E0CD96D70E207B58622D9FF78BEE609A4";
        let expected_session_proof = "87BF2829F780EF88C1BFB63F39547DAA3CC787B40978C27CDC50FDEBFD324470";

        let session = srp_derive_session(
            client_secret,
            server_public,
            salt,
            username,
            &private_key,
        ).unwrap();

        eprintln!("Rust Session Key: {}", session.key);
        eprintln!("Rust Session Proof: {}", session.proof);

        assert_eq!(session.key.to_uppercase(), expected_session_key);
        assert_eq!(session.proof.to_uppercase(), expected_session_proof);
    }

    #[test]
    fn test_full_srp_flow() {
        // 1. Registration: Generate salt and verifier
        let salt = srp_generate_salt();
        let identity = "testuser@example.com";
        let password_hash = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";

        let private_key = srp_derive_private_key(&salt, identity, password_hash).unwrap();
        let verifier = srp_derive_verifier(&private_key).unwrap();

        // 2. Login: Client generates ephemeral
        let client_ephemeral = srp_generate_ephemeral();

        // 3. Server generates ephemeral and sends to client
        let server_ephemeral = srp_generate_ephemeral_server(&verifier).unwrap();

        // 4. Client derives session
        let client_session = srp_derive_session(
            &client_ephemeral.secret,
            &server_ephemeral.public,
            &salt,
            identity,
            &private_key,
        ).unwrap();

        // 5. Server verifies client proof and derives session
        let server_session = srp_derive_session_server(
            &server_ephemeral.secret,
            &client_ephemeral.public,
            &salt,
            identity,
            &verifier,
            &client_session.proof,
        ).unwrap();

        // Server should successfully verify and return a session
        assert!(server_session.is_some());
        let server_session = server_session.unwrap();

        // Both should have the same session key
        assert_eq!(client_session.key, server_session.key);
    }

    #[test]
    fn test_wrong_password_fails() {
        // Setup with correct credentials
        let salt = srp_generate_salt();
        let identity = "testuser";
        let correct_password_hash = "CORRECT_PASSWORD_HASH_0123456789";
        let wrong_password_hash = "WRONG_PASSWORD_HASH_0123456789AB";

        let correct_private_key = srp_derive_private_key(&salt, identity, correct_password_hash).unwrap();
        let verifier = srp_derive_verifier(&correct_private_key).unwrap();

        // Client uses wrong password
        let wrong_private_key = srp_derive_private_key(&salt, identity, wrong_password_hash).unwrap();

        let client_ephemeral = srp_generate_ephemeral();
        let server_ephemeral = srp_generate_ephemeral_server(&verifier).unwrap();

        // Client derives session with wrong password
        let client_session = srp_derive_session(
            &client_ephemeral.secret,
            &server_ephemeral.public,
            &salt,
            identity,
            &wrong_private_key,
        ).unwrap();

        // Server should reject the client proof
        let server_session = srp_derive_session_server(
            &server_ephemeral.secret,
            &client_ephemeral.public,
            &salt,
            identity,
            &verifier,
            &client_session.proof,
        ).unwrap();

        // Server should return None (authentication failed)
        assert!(server_session.is_none());
    }

    #[test]
    fn test_hex_conversion() {
        // Test round-trip
        let original = vec![0x00, 0x01, 0x0A, 0xFF, 0x10];
        let hex = bytes_to_hex(&original);
        assert_eq!(hex, "00010AFF10");

        let decoded = hex_to_bytes(&hex).unwrap();
        assert_eq!(decoded, original);

        // Test lowercase input
        let decoded_lower = hex_to_bytes("00010aff10").unwrap();
        assert_eq!(decoded_lower, original);
    }
}
