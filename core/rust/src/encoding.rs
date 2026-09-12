//! Crate-wide byte encodings: hex, base64 and the UUID text form.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

use crate::error::{VaultError, VaultResult};

/// Lowercase hex of a byte slice.
pub(crate) fn hex_encode_lower(bytes: &[u8]) -> String {
    hex_encode(bytes, b"0123456789abcdef")
}

/// Uppercase hex of a byte slice.
pub(crate) fn hex_encode_upper(bytes: &[u8]) -> String {
    hex_encode(bytes, b"0123456789ABCDEF")
}

fn hex_encode(bytes: &[u8], alphabet: &[u8; 16]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(alphabet[(b >> 4) as usize] as char);
        out.push(alphabet[(b & 0x0F) as usize] as char);
    }
    out
}

/// Decode a hex string of either case. `None` on odd length or a non-hex character.
pub(crate) fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    let bytes = hex.as_bytes();
    if bytes.len() % 2 != 0 {
        return None;
    }
    bytes.chunks_exact(2).map(|pair| Some((nibble(pair[0])? << 4) | nibble(pair[1])?)).collect()
}

fn nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Standard base64 (padded) of a byte slice.
pub(crate) fn base64_encode(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}

/// Decode a standard base64 string, with the error the callers report.
pub(crate) fn base64_decode(value: &str) -> VaultResult<Vec<u8>> {
    BASE64.decode(value).map_err(|_| VaultError::General("Invalid base64".to_string()))
}

/// The lowercase `8-4-4-4-12` text form of 16 bytes.
pub(crate) fn format_uuid(bytes: &[u8; 16]) -> String {
    let hex = hex_encode_lower(bytes);
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips_in_both_cases() {
        let bytes = vec![0x00u8, 0x1f, 0xab, 0xff];
        assert_eq!(hex_encode_lower(&bytes), "001fabff");
        assert_eq!(hex_encode_upper(&bytes), "001FABFF");
        assert_eq!(hex_decode("001fabff").unwrap(), bytes);
        assert_eq!(hex_decode("001FABFF").unwrap(), bytes);
        assert_eq!(hex_decode(""), Some(Vec::new()));
        assert_eq!(hex_decode("abc"), None);
        assert_eq!(hex_decode("gg"), None);
        assert_eq!(hex_decode("0é9"), None);
    }

    #[test]
    fn uuid_text_form_is_lowercase_and_grouped() {
        let bytes = [0xABu8; 16];
        assert_eq!(format_uuid(&bytes), "abababab-abab-abab-abab-abababababab");
    }
}
