//! RFC 6238 TOTP code generation, shared by every client.

#[cfg(test)]
mod tests;

use hmac::{Hmac, Mac};
use sha1::Sha1;
use sha2::{Sha256, Sha512};

/// The HMAC algorithm RFC 6238 assumes when none is given.
pub const DEFAULT_ALGORITHM: &str = "SHA1";

/// The code length RFC 6238 assumes when none is given.
pub const DEFAULT_DIGITS: u32 = 6;

/// The time step in seconds RFC 6238 assumes when none is given.
pub const DEFAULT_PERIOD: u32 = 30;

/// The longest time step accepted; anything above falls back to [`DEFAULT_PERIOD`].
const MAX_PERIOD: u32 = 300;

/// A supported HMAC algorithm.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Algorithm {
    Sha1,
    Sha256,
    Sha512,
}

/// The algorithm for a name such as "SHA256", "sha-256" or "SHA_512"; anything unknown is SHA1.
fn parse_algorithm(name: &str) -> Algorithm {
    let normalized: String = name.chars().filter(|c| !c.is_whitespace() && *c != '-' && *c != '_').collect::<String>().to_ascii_uppercase();
    match normalized.as_str() {
        "SHA256" => Algorithm::Sha256,
        "SHA512" => Algorithm::Sha512,
        _ => Algorithm::Sha1,
    }
}

/// The digit count if supported (6 to 8), else [`DEFAULT_DIGITS`].
fn normalize_digits(digits: u32) -> u32 {
    if (6..=8).contains(&digits) { digits } else { DEFAULT_DIGITS }
}

/// The period if usable (1 to 300 seconds), else [`DEFAULT_PERIOD`].
fn normalize_period(period: u32) -> u32 {
    if (1..=MAX_PERIOD).contains(&period) { period } else { DEFAULT_PERIOD }
}

/// Decode an RFC 4648 Base32 secret, ignoring case, spaces, dashes and `=` padding. `None` on any other character.
fn decode_base32(secret: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bytes = Vec::with_capacity(secret.len() * 5 / 8);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for ch in secret.chars() {
        if ch.is_whitespace() || ch == '-' || ch == '=' {
            continue;
        }
        let value = ALPHABET.iter().position(|&a| a == ch.to_ascii_uppercase() as u8)? as u32;
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Some(bytes)
}

/// HMAC of `counter` (8 bytes, big-endian) with `key`.
fn hmac_counter(algorithm: Algorithm, key: &[u8], counter: u64) -> Vec<u8> {
    let message = counter.to_be_bytes();
    // Hmac accepts keys of any length, so new_from_slice cannot fail.
    match algorithm {
        Algorithm::Sha1 => Hmac::<Sha1>::new_from_slice(key).map(|mut mac| { mac.update(&message); mac.finalize().into_bytes().to_vec() }),
        Algorithm::Sha256 => Hmac::<Sha256>::new_from_slice(key).map(|mut mac| { mac.update(&message); mac.finalize().into_bytes().to_vec() }),
        Algorithm::Sha512 => Hmac::<Sha512>::new_from_slice(key).map(|mut mac| { mac.update(&message); mac.finalize().into_bytes().to_vec() }),
    }
    .expect("HMAC takes keys of any length")
}

/// The TOTP code for a Base32 `secret` at `unix_seconds`, or `None` when the secret is empty or not Base32 or the time is negative.
pub fn generate_totp_code(secret: &str, unix_seconds: i64, algorithm: &str, digits: u32, period: u32) -> Option<String> {
    let key = decode_base32(secret)?;
    if key.is_empty() || unix_seconds < 0 {
        return None;
    }
    let digits = normalize_digits(digits);
    let counter = unix_seconds as u64 / u64::from(normalize_period(period));
    let hash = hmac_counter(parse_algorithm(algorithm), &key, counter);

    // Dynamic truncation, RFC 4226 section 5.3.
    let offset = (hash[hash.len() - 1] & 0x0f) as usize;
    let binary = u32::from_be_bytes([hash[offset] & 0x7f, hash[offset + 1], hash[offset + 2], hash[offset + 3]]);
    let code = binary % 10u32.pow(digits);
    Some(format!("{code:0width$}", width = digits as usize))
}
