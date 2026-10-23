//! Tests for TOTP code generation.

use super::*;

/// RFC 6238 appendix B seeds: the ASCII strings "1234567890..." of 20, 32 and 64 bytes, Base32 encoded with padding.
const SEED_SHA1: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const SEED_SHA256: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====";
const SEED_SHA512: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA=";

/// RFC 6238 appendix B: (time, algorithm, seed, 8-digit code) with a 30 second step.
const VECTORS: &[(i64, &str, &str, &str)] = &[
    (59, "SHA1", SEED_SHA1, "94287082"),
    (59, "SHA256", SEED_SHA256, "46119246"),
    (59, "SHA512", SEED_SHA512, "90693936"),
    (1111111109, "SHA1", SEED_SHA1, "07081804"),
    (1111111109, "SHA256", SEED_SHA256, "68084774"),
    (1111111109, "SHA512", SEED_SHA512, "25091201"),
    (1111111111, "SHA1", SEED_SHA1, "14050471"),
    (1111111111, "SHA256", SEED_SHA256, "67062674"),
    (1111111111, "SHA512", SEED_SHA512, "99943326"),
    (1234567890, "SHA1", SEED_SHA1, "89005924"),
    (1234567890, "SHA256", SEED_SHA256, "91819424"),
    (1234567890, "SHA512", SEED_SHA512, "93441116"),
    (2000000000, "SHA1", SEED_SHA1, "69279037"),
    (2000000000, "SHA256", SEED_SHA256, "90698825"),
    (2000000000, "SHA512", SEED_SHA512, "38618901"),
    (20000000000, "SHA1", SEED_SHA1, "65353130"),
    (20000000000, "SHA256", SEED_SHA256, "77737706"),
    (20000000000, "SHA512", SEED_SHA512, "47863826"),
];

#[test]
fn matches_rfc_6238_vectors() {
    for &(time, algorithm, seed, expected) in VECTORS {
        assert_eq!(generate_totp_code(seed, time, algorithm, 8, 30).as_deref(), Some(expected), "T={time} {algorithm}");
    }
}

#[test]
fn six_digit_code_is_the_low_digits() {
    assert_eq!(generate_totp_code(SEED_SHA1, 59, "SHA1", 6, 30).as_deref(), Some("287082"));
    assert_eq!(generate_totp_code(SEED_SHA1, 1111111109, "SHA1", 6, 30).as_deref(), Some("081804"));
}

#[test]
fn accepts_algorithm_spellings() {
    for name in ["sha256", "SHA-256", "sha_256", " SHA256 "] {
        assert_eq!(generate_totp_code(SEED_SHA256, 59, name, 8, 30).as_deref(), Some("46119246"), "{name}");
    }
}

#[test]
fn unknown_parameters_fall_back_to_defaults() {
    let defaults = generate_totp_code(SEED_SHA1, 59, "SHA1", 6, 30);
    assert_eq!(generate_totp_code(SEED_SHA1, 59, "MD5", 6, 30), defaults);
    assert_eq!(generate_totp_code(SEED_SHA1, 59, "", 12, 0), defaults);
    assert_eq!(generate_totp_code(SEED_SHA1, 59, "SHA1", 5, 301), defaults);
}

#[test]
fn period_picks_the_time_step() {
    // T=59 with a 60 second step is counter 0, the same counter as T=29 with a 30 second step.
    assert_eq!(generate_totp_code(SEED_SHA1, 59, "SHA1", 8, 60), generate_totp_code(SEED_SHA1, 29, "SHA1", 8, 30));
}

#[test]
fn secret_tolerates_case_spaces_dashes_and_padding() {
    let expected = generate_totp_code("JBSWY3DPEHPK3PXP", 59, "SHA1", 6, 30);
    assert!(expected.is_some());
    for secret in ["jbswy3dpehpk3pxp", "JBSW Y3DP EHPK 3PXP", "JBSW-Y3DP-EHPK-3PXP", "JBSWY3DPEHPK3PXP===="] {
        assert_eq!(generate_totp_code(secret, 59, "SHA1", 6, 30), expected, "{secret}");
    }
}

#[test]
fn rejects_unusable_input() {
    assert_eq!(generate_totp_code("not base32!", 59, "SHA1", 6, 30), None);
    assert_eq!(generate_totp_code("", 59, "SHA1", 6, 30), None);
    assert_eq!(generate_totp_code("====", 59, "SHA1", 6, 30), None);
    assert_eq!(generate_totp_code(SEED_SHA1, -1, "SHA1", 6, 30), None);
}
