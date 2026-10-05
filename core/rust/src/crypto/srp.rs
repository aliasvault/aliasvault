//! SRP (Secure Remote Password) protocol implementation.
//!
//! Uses RustCrypto `srp` crate for most operations, except certain places
//! where the format must stay compatible with the `SecureRemotePassword` .NET package
//! used by the API server and the `secure-remote-password` library used in the JS test suite.

use num_bigint::BigUint;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use srp::client::SrpClient;
use srp::groups::G_2048;
use srp::server::SrpServer;
use srp::utils::{compute_k, compute_u};
use subtle::ConstantTimeEq;
use thiserror::Error;

use crate::common::encoding::{hex_decode, hex_encode_upper as bytes_to_hex};
use crate::common::rng::fill_random;

/// Byte length of the 2048-bit group modulus N; all padded values use this size.
const N_BYTES: usize = 256;

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
fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, SrpError> {
    let hex = hex.trim();
    let hex = hex.strip_prefix("0x").or_else(|| hex.strip_prefix("0X")).unwrap_or(hex);
    if hex.is_empty() {
        return Err(SrpError::InvalidHex("empty hex string".to_string()));
    }
    hex_decode(hex).ok_or_else(|| SrpError::InvalidHex(format!("malformed hex string of length {}", hex.len())))
}

/// Generate cryptographically secure random bytes.
fn generate_random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    fill_random(&mut bytes);
    bytes
}

/// Left-pad bytes with zeros to a specific length.
fn pad_to_length(bytes: Vec<u8>, target_len: usize) -> Vec<u8> {
    if bytes.len() >= target_len {
        bytes
    } else {
        let mut padded = vec![0u8; target_len - bytes.len()];
        padded.extend(bytes);
        padded
    }
}

/// Convert a BigUint to big-endian bytes left-padded to the group size (256 bytes).
fn to_padded_bytes(value: &BigUint) -> Vec<u8> {
    pad_to_length(value.to_bytes_be(), N_BYTES)
}

/// A random 32-byte SRP salt as an uppercase hex string.
pub fn srp_generate_salt() -> String {
    bytes_to_hex(&generate_random_bytes(32))
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
    let x = BigUint::from_bytes_be(&hex_to_bytes(private_key)?);

    let client = SrpClient::<Sha256>::new(&G_2048);
    let v = client.compute_v(&x);

    Ok(bytes_to_hex(&to_padded_bytes(&v)))
}

/// A client ephemeral pair: `A = g^a mod N` for a random 64-byte secret `a`.
pub fn srp_generate_ephemeral() -> SrpEphemeral {
    let client = SrpClient::<Sha256>::new(&G_2048);

    let a = generate_random_bytes(64);
    let a_pub = client.compute_public_ephemeral(&a);

    SrpEphemeral { public: bytes_to_hex(&pad_to_length(a_pub, N_BYTES)), secret: bytes_to_hex(&a) }
}

/// The client session (key `K` and proof `M1`) from the server's public ephemeral `B`; hex in, hex out.
pub fn srp_derive_session(client_secret: &str, server_public: &str, salt: &str, identity: &str, private_key: &str) -> Result<SrpSession, SrpError> {
    let identity = identity.to_lowercase();
    let a = BigUint::from_bytes_be(&hex_to_bytes(client_secret)?);
    let b_pub = BigUint::from_bytes_be(&hex_to_bytes(server_public)?);
    let salt_bytes = hex_to_bytes(salt)?;
    let x = BigUint::from_bytes_be(&hex_to_bytes(private_key)?);

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
    let key_bytes = hex_to_bytes(session_key)?;
    let server_m2_bytes = hex_to_bytes(server_proof)?;

    let expected_m2 = compute_m2(&a_pub_bytes, &m1_bytes, &key_bytes);

    Ok(expected_m2.ct_eq(&server_m2_bytes).unwrap_u8() == 1)
}

// Server side of the handshake.

/// A server ephemeral pair: `B = k*v + g^b mod N` for a random 64-byte secret `b`, from the hex verifier.
pub fn srp_generate_ephemeral_server(verifier: &str) -> Result<SrpEphemeral, SrpError> {
    let v_bytes = hex_to_bytes(verifier)?;

    let server = SrpServer::<Sha256>::new(&G_2048);

    let b = generate_random_bytes(64);
    let b_pub = server.compute_public_ephemeral(&b, &v_bytes);

    Ok(SrpEphemeral { public: bytes_to_hex(&pad_to_length(b_pub, N_BYTES)), secret: bytes_to_hex(&b) })
}

/// The server session (key `K` and proof `M2`) once the client's proof `M1` verifies; `None` when it does not.
pub fn srp_derive_session_server(
    server_secret: &str,
    client_public: &str,
    salt: &str,
    identity: &str,
    verifier: &str,
    client_proof: &str,
) -> Result<Option<SrpSession>, SrpError> {
    let identity = identity.to_lowercase();
    let b = BigUint::from_bytes_be(&hex_to_bytes(server_secret)?);
    let a_pub = BigUint::from_bytes_be(&hex_to_bytes(client_public)?);
    let salt_bytes = hex_to_bytes(salt)?;
    let v = BigUint::from_bytes_be(&hex_to_bytes(verifier)?);
    let client_m1 = hex_to_bytes(client_proof)?;

    // Safeguard against malicious A (A mod N must not be 0)
    if &a_pub % &G_2048.n == BigUint::default() {
        return Err(SrpError::InvalidParameter("client public ephemeral is invalid".to_string()));
    }

    let server = SrpServer::<Sha256>::new(&G_2048);
    let k = compute_k::<Sha256>(&G_2048);

    // B = k*v + g^b mod N
    let b_pub = server.compute_b_pub(&b, &k, &v);

    let a_pub_bytes = to_padded_bytes(&a_pub);
    let b_pub_bytes = to_padded_bytes(&b_pub);

    let u = compute_u::<Sha256>(&a_pub_bytes, &b_pub_bytes);
    if u == BigUint::default() {
        return Err(SrpError::InvalidParameter("scrambling parameter u is zero".to_string()));
    }

    // S = (A * v^u)^b mod N
    let s = server.compute_premaster_secret(&a_pub, &v, &u, &b);

    let key = derive_session_key(&s);
    let expected_m1 = compute_m1(&a_pub_bytes, &b_pub_bytes, &salt_bytes, &identity, &key);

    if expected_m1.ct_eq(&client_m1).unwrap_u8() != 1 {
        return Ok(None);
    }

    let m2 = compute_m2(&a_pub_bytes, &expected_m1, &key);

    Ok(Some(SrpSession { proof: bytes_to_hex(&m2), key: bytes_to_hex(&key) }))
}

/*
 * Wire format primitives that deviate from the `srp` crate on purpose: the SecureRemotePassword (.NET/JS) format hashes
 * the padded premaster secret into K and uses the RFC 2945 M1, while the crate uses raw S and M1 = H(A|B|S).
 */

/// Derive the session key K = H(PAD(S)) from the premaster secret.
fn derive_session_key(s: &BigUint) -> Vec<u8> {
    Sha256::digest(to_padded_bytes(s)).to_vec()
}

/// Compute M1 = H(H(N) XOR H(g) | H(I) | s | A | B | K)
///
/// Note: H(g) uses g without padding, unlike k = H(N, PAD(g))
fn compute_m1(a_pub: &[u8], b_pub: &[u8], salt: &[u8], identity: &str, key: &[u8]) -> Vec<u8> {
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
fn compute_m2(a_pub: &[u8], m1: &[u8], key: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(a_pub);
    hasher.update(m1);
    hasher.update(key);
    hasher.finalize().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test with fixed values for deterministic verification.
    #[test]
    fn fixed_values() {
        let salt = "0A0B0C0D0E0F101112131415161718191A1B1C1D1E1F202122232425262728292A2B2C2D2E2F303132333435363738393A3B3C3D3E3F";
        let identity = "testuser";
        let password_hash = "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899";

        let expected_private_key = "37D921B103087DDBCFEE50E240DBF5904BBC021BD07391F206CA74BE5430D79B";
        let expected_verifier = "603ABD0F6C5494976B140BBF29D988989FD88654438994959D851C83FC891FA22C81B7CD3B1BBC5472651473183789A4DB5454D530BDEF328DCBA19C112ED266584D8750AEFDCFC0076FD40B3E16773672994C7CB56B4F6CD5FCA47927F9688483937890054D208DDBDD5117F18461B6AD7A279495583B7D99CDC1EB678E9402171F43DC7732549B5A5A3A4A2BF586686887E09D1DED55A7945C20F4DB62915DCF7FD4D7ECED87758B3E19E25CFC668FDB92FCE15E9452DE7F78BDB9BC80DE25882769870E156B2860A169F33045298CEC7700975E3EF4AAE5B41CE6086E2593EDCF2BEA8F3B613258259197C4AE8A67055ED5546C83F6EF035BA788EC63A1AE";

        let private_key = srp_derive_private_key(salt, identity, password_hash).unwrap();
        assert_eq!(private_key.to_uppercase(), expected_private_key);

        let verifier = srp_derive_verifier(&private_key).unwrap();
        assert_eq!(verifier.to_uppercase(), expected_verifier);
    }

    /// Test session derivation with fixed ephemeral values.
    #[test]
    fn session_fixed_values() {
        let salt = "0A0B0C0D0E0F101112131415161718191A1B1C1D1E1F202122232425262728292A2B2C2D2E2F303132333435363738393A3B3C3D3E3F";
        let identity = "testuser";
        let password_hash = "AABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899";

        let private_key = srp_derive_private_key(salt, identity, password_hash).unwrap();

        let client_secret = "89697cc13c1cea1f44c5f6b3f8f0cb7ce28246c80de10ca5d4976575dbcb0318";
        let server_public = "523d0e314fccaace5ad5007357b07bb2fb2c5f566be0b812cbe4ffa65adc5bdd5cd59d9ca921b7491481d2963733513968e7bea637a733665f8e9fb7a18ba613a03740eed9ea3795489659a486cd87352054ed49f0636bb2605b8d836a459151cb670d35e8377202d9e1569bf88d0c86bd83d303d8775a65867b68fc7f9a9d5d59c76c413cb1b4d33f1d5eb784d1d18a5705800729a5d566548297c3b84ec1077c4546ab3c9b159a6d6c7265cdc784f36f731fa371e14bc506a544713591579d0a6952c2539746963434f0e97a024c0e93701008e4c54b620a9259d071b88c0a4cf102eaa22732ecfcd1fd23a81ee180074db1b5cee1b3e9172f76153f8d46bc";

        let expected_session_key = "AD713F5D8F520B7B9413CDD9EF6D9B5FE37F23A9B62C5E2B90D2291F8C3A9E6F";
        let expected_session_proof = "698D0DA7137A0FC4A55B49525C1312ADCD07788E8CD5FFF5BD195B3C17B6B3DF";

        let session = srp_derive_session(client_secret, server_public, salt, identity, &private_key).unwrap();

        assert_eq!(session.key.to_uppercase(), expected_session_key);
        assert_eq!(session.proof.to_uppercase(), expected_session_proof);
    }

    /// Test with realistic 32-byte salt.
    #[test]
    fn realistic_salt() {
        let salt = "7c9d6615bfeb06c552c7fbcbfbe7030035a09f058ed7cf7755ca6d3bfa56393c";
        let username = "testuser";
        let password_hash = "ABCD1234567890ABCD1234567890ABCD1234567890ABCD1234567890ABCD1234";

        let expected_private_key = "352C41C945185EDC02EBA1087A02D06A686A194D3542AE174B4F75F340E4E02E";
        let expected_verifier = "8612168CF700A1CBAE568175B1BDD9B93874A9029B2EA34126910EABFE7DCEA57345560AD96754E1C5A5A2272F1C794D7C6A7D5A756FD37EF78170A3162051035D115AA376F85330701586A714C97413F84BAE12A87497357C0483E443B7D3B75B3C19BCF845ABD38956D2EAEFE733DC696D88277245DC7E25C9013D77053F82E9400F6918BF58176D536EB7D90572A645790E6F5660FD0FB8D5673B584F1F33F06C824CA1CF246BED84E228745CD4ABC1184E5057D03191AB9253F86A407970A4578DC6763D7D42AF2CB71C79F60BB71CA16CF98A17E4F3D62BE8396593427487115163B668A8E0069487C763342B58EFAF9499EBB87DE07E52836B3DF4F28C";

        let private_key = srp_derive_private_key(salt, username, password_hash).unwrap();
        assert_eq!(private_key.to_uppercase(), expected_private_key);

        let verifier = srp_derive_verifier(&private_key).unwrap();
        assert_eq!(verifier.to_uppercase(), expected_verifier);

        let client_secret = "d21695287e680db505882ba699bb1a417fe064cc817ead8f2e872fb4b8612273";
        let server_public = "02ea98a39b29fee876b183124e9dd8f4e5dedf429a1bb0e74dafd67a6a855f8e43a317edb17b93fc6c42c7ed5a2d5cc166fe9dabc66e71475a3a947aec440c23e5c8b347ee4352a84a2fb94d683d1545ef2ac7571e5032d68a0bdfe8cc16d8cf852851dc9a74690d35439a722dc22eaa682ee50eb354131445fd414d4e30dd7653560a4342ffccf392f4b658b37f939a179f01be15aa4364f7d720eebb850a5cad023ce07ed09f47da00ba00ac31df2bb251c2e910a8d50044b9dc926711b648718357da4b233078a17862e5ad57df0cb13325ef39acd42625fd858f0073e073bd61eee07a89be4c2d4b52d868324fea7b68acf3dce94733973469fdc1cc8d32";

        let expected_session_key = "7564C550D5BF148D17B33C251B71EA2E0CD96D70E207B58622D9FF78BEE609A4";
        let expected_session_proof = "87BF2829F780EF88C1BFB63F39547DAA3CC787B40978C27CDC50FDEBFD324470";

        let session = srp_derive_session(client_secret, server_public, salt, username, &private_key).unwrap();

        assert_eq!(session.key.to_uppercase(), expected_session_key);
        assert_eq!(session.proof.to_uppercase(), expected_session_proof);
    }

    #[test]
    fn full_srp_flow() {
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

        // Salts are 32 bytes, public values are padded to the 2048-bit group as the server expects.
        assert_eq!((salt.len(), client_ephemeral.public.len(), server_ephemeral.public.len(), verifier.len()), (64, 512, 512, 512));

        // 4. Client derives session
        let client_session = srp_derive_session(&client_ephemeral.secret, &server_ephemeral.public, &salt, identity, &private_key).unwrap();

        // 5. Server verifies client proof and derives session
        let server_session = srp_derive_session_server(
            &server_ephemeral.secret,
            &client_ephemeral.public,
            &salt,
            identity,
            &verifier,
            &client_session.proof,
        )
        .unwrap();

        let server_session = server_session.expect("server should accept valid client proof");

        assert_eq!(client_session.key, server_session.key);

        // 6. Client verifies server proof (M2)
        let verified = srp_verify_session(&client_ephemeral.public, &client_session.proof, &client_session.key, &server_session.proof).unwrap();
        assert!(verified);

        // A tampered server proof should fail client-side verification
        let mut tampered = server_session.proof.clone();
        let flipped = if tampered.starts_with('0') { "1" } else { "0" };
        tampered.replace_range(0..1, flipped);
        let verified_tampered = srp_verify_session(&client_ephemeral.public, &client_session.proof, &client_session.key, &tampered).unwrap();
        assert!(!verified_tampered);
    }

    /// Mixed-case identity must produce the same values as lowercase, matching
    /// the C# implementation's ToLowerInvariant() normalization.
    #[test]
    fn identity_lowercased() {
        let salt = "0A0B0C0D0E0F10111213141516171819";
        let password_hash = "AABBCCDD";

        let key_lower = srp_derive_private_key(salt, "testuser", password_hash).unwrap();
        let key_mixed = srp_derive_private_key(salt, "TestUser", password_hash).unwrap();
        assert_eq!(key_lower, key_mixed);

        // Full flow: client uses mixed case, server uses lowercase
        let salt = srp_generate_salt();
        let private_key = srp_derive_private_key(&salt, "TestUser", password_hash).unwrap();
        let verifier = srp_derive_verifier(&private_key).unwrap();

        let client_ephemeral = srp_generate_ephemeral();
        let server_ephemeral = srp_generate_ephemeral_server(&verifier).unwrap();

        let client_session = srp_derive_session(&client_ephemeral.secret, &server_ephemeral.public, &salt, "TESTUSER", &private_key).unwrap();

        let server_session = srp_derive_session_server(
            &server_ephemeral.secret,
            &client_ephemeral.public,
            &salt,
            "testuser",
            &verifier,
            &client_session.proof,
        )
        .unwrap();

        assert!(server_session.is_some());
        assert_eq!(client_session.key, server_session.unwrap().key);
    }

    #[test]
    fn wrong_password_fails() {
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
        let client_session = srp_derive_session(&client_ephemeral.secret, &server_ephemeral.public, &salt, identity, &wrong_private_key).unwrap();

        // Server should reject the client proof
        let server_session = srp_derive_session_server(
            &server_ephemeral.secret,
            &client_ephemeral.public,
            &salt,
            identity,
            &verifier,
            &client_session.proof,
        )
        .unwrap();

        assert!(server_session.is_none());
    }

    #[test]
    fn malicious_server_public_rejected() {
        let salt = srp_generate_salt();
        let identity = "testuser";
        let private_key = srp_derive_private_key(&salt, identity, "AABBCCDD").unwrap();
        let client_ephemeral = srp_generate_ephemeral();

        // B = 0 and B = N are both ≡ 0 mod N and must be rejected
        let n_hex = bytes_to_hex(&G_2048.n.to_bytes_be());
        for bad_b in ["00", n_hex.as_str()] {
            let result = srp_derive_session(&client_ephemeral.secret, bad_b, &salt, identity, &private_key);
            assert!(matches!(result, Err(SrpError::InvalidParameter(_))));
        }
    }

    #[test]
    fn malicious_client_public_rejected() {
        let salt = srp_generate_salt();
        let identity = "testuser";
        let private_key = srp_derive_private_key(&salt, identity, "AABBCCDD").unwrap();
        let verifier = srp_derive_verifier(&private_key).unwrap();
        let server_ephemeral = srp_generate_ephemeral_server(&verifier).unwrap();

        let n_hex = bytes_to_hex(&G_2048.n.to_bytes_be());
        for bad_a in ["00", n_hex.as_str()] {
            let result = srp_derive_session_server(&server_ephemeral.secret, bad_a, &salt, identity, &verifier, "AABBCCDD");
            assert!(matches!(result, Err(SrpError::InvalidParameter(_))));
        }
    }

    /// Decoding itself is `common::encoding`'s; SRP adds the `0x` prefix, trimming and a typed error for empty input.
    #[test]
    fn hex_input_accepts_a_prefix_and_refuses_empty_or_malformed_text() {
        assert_eq!(hex_to_bytes(" 0x00010aFF10 ").unwrap(), vec![0x00, 0x01, 0x0A, 0xFF, 0x10]);
        for bad in ["", "0x", "ABC", "GG", "0é9"] {
            assert!(matches!(hex_to_bytes(bad), Err(SrpError::InvalidHex(_))), "{bad:?}");
        }
    }
}
