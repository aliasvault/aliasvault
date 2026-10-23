//! Tests of the SRP client, against a server side of the handshake built here from the same `srp` crate primitives, so
//! the full client/server flow runs locally. The fixed vectors come from the .NET `SecureRemotePassword` server.

use num_bigint::BigUint;
use sha2::Sha256;
use srp::groups::G_2048;
use srp::server::SrpServer;
use srp::utils::{compute_k, compute_u};
use subtle::ConstantTimeEq;

use crate::common::encoding::hex_encode_upper as bytes_to_hex;
use crate::common::rng::random_bytes;
use crate::crypto::srp::*;

/// A server ephemeral pair: `B = k*v + g^b mod N` for a random 64-byte secret `b`, from the hex verifier.
fn srp_generate_ephemeral_server(verifier: &str) -> Result<SrpEphemeral, SrpError> {
    let v_bytes = hex_to_bytes(verifier)?;
    let server = SrpServer::<Sha256>::new(&G_2048);
    let b = random_bytes(64);
    let b_pub = server.compute_public_ephemeral(&b, &v_bytes);
    Ok(SrpEphemeral { public: bytes_to_hex(&pad_to_length(b_pub, N_BYTES)), secret: bytes_to_hex(&b) })
}

/// The server session (key `K` and proof `M2`) once the client's proof `M1` verifies; `None` when it does not.
fn srp_derive_session_server(server_secret: &str, client_public: &str, salt: &str, identity: &str, verifier: &str, client_proof: &str) -> Result<Option<SrpSession>, SrpError> {
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

/// Fixed values from the .NET server implementation. Never regenerate them.
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

/// Session derivation with fixed ephemeral values. Never regenerate them.
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

/// A realistic 32-byte salt, with fixed values from the .NET server. Never regenerate them.
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
    // 1. Registration: generate salt and verifier
    let salt = srp_generate_salt();
    let identity = "testuser@example.com";
    let password_hash = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";

    let private_key = srp_derive_private_key(&salt, identity, password_hash).unwrap();
    let verifier = srp_derive_verifier(&private_key).unwrap();

    // 2. Login: client generates ephemeral
    let client_ephemeral = srp_generate_ephemeral();

    // 3. Server generates ephemeral and sends to client
    let server_ephemeral = srp_generate_ephemeral_server(&verifier).unwrap();

    // Salts are 32 bytes, public values are padded to the 2048-bit group as the server expects.
    assert_eq!((salt.len(), client_ephemeral.public.len(), server_ephemeral.public.len(), verifier.len()), (64, 512, 512, 512));

    // 4. Client derives session
    let client_session = srp_derive_session(&client_ephemeral.secret, &server_ephemeral.public, &salt, identity, &private_key).unwrap();

    // 5. Server verifies client proof and derives session
    let server_session = srp_derive_session_server(&server_ephemeral.secret, &client_ephemeral.public, &salt, identity, &verifier, &client_session.proof).unwrap();
    let server_session = server_session.expect("server should accept valid client proof");
    assert_eq!(client_session.key, server_session.key);

    // 6. Client verifies server proof (M2)
    assert!(srp_verify_session(&client_ephemeral.public, &client_session.proof, &client_session.key, &server_session.proof).unwrap());

    // A tampered server proof should fail client-side verification
    let mut tampered = server_session.proof.clone();
    let flipped = if tampered.starts_with('0') { "1" } else { "0" };
    tampered.replace_range(0..1, flipped);
    assert!(!srp_verify_session(&client_ephemeral.public, &client_session.proof, &client_session.key, &tampered).unwrap());
}

/// Mixed-case identity must produce the same values as lowercase, matching the C# implementation's ToLowerInvariant().
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
    let server_session = srp_derive_session_server(&server_ephemeral.secret, &client_ephemeral.public, &salt, "testuser", &verifier, &client_session.proof).unwrap();

    assert!(server_session.is_some());
    assert_eq!(client_session.key, server_session.unwrap().key);
}

#[test]
fn wrong_password_fails() {
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

    let client_session = srp_derive_session(&client_ephemeral.secret, &server_ephemeral.public, &salt, identity, &wrong_private_key).unwrap();

    // Server should reject the client proof
    let server_session = srp_derive_session_server(&server_ephemeral.secret, &client_ephemeral.public, &salt, identity, &verifier, &client_session.proof).unwrap();
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
