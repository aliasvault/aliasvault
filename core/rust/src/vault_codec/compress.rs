//! gzip compress / gunzip decompress.

use std::io::Write;

use flate2::write::GzEncoder;
use flate2::Compression;

use crate::common::error::{VaultError, VaultResult};
use crate::common::gzip::{gunzip_capped, GZIP_MAGIC};

/// gzip the given bytes.
pub fn gzip(bytes: &[u8]) -> VaultResult<Vec<u8>> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(bytes)
        .map_err(|e| VaultError::General(format!("gzip write failed: {}", e)))?;
    encoder
        .finish()
        .map_err(|e| VaultError::General(format!("gzip finish failed: {}", e)))
}

/// Cap on a decompressed payload, so a gzip bomb in a shared manifest cannot exhaust memory. Derived from the
/// server's default `MAX_UPLOAD_SIZE_MB` (100 MB per vault write, compressed): 5x that leaves room for highly
/// compressible JSON while staying well below what a wasm32 client can hold.
pub const MAX_DECOMPRESSED_PAYLOAD_BYTES: u64 = 512 * 1024 * 1024;

/// Decompress gzipped bytes into a UTF-8 string, refusing output above [`MAX_DECOMPRESSED_PAYLOAD_BYTES`].
pub fn gunzip_to_string(bytes: &[u8]) -> VaultResult<String> {
    gunzip_to_string_capped(bytes, MAX_DECOMPRESSED_PAYLOAD_BYTES)
}

/// Decompress gzipped bytes into a UTF-8 string, refusing output above `limit` bytes.
fn gunzip_to_string_capped(bytes: &[u8], limit: u64) -> VaultResult<String> {
    String::from_utf8(gunzip_capped(bytes, limit)?).map_err(|e| VaultError::General(format!("gunzip failed: {}", e)))
}

/// Decompress a packed payload to its envelope JSON string, supporting both gzipped and plain values:
/// gzip (leading `1f 8b`) is gunzipped; anything else is treated as raw, uncompressed UTF-8 JSON.
pub fn decompress_to_string(bytes: &[u8]) -> VaultResult<String> {
    if bytes.starts_with(&GZIP_MAGIC) {
        return gunzip_to_string(bytes);
    }
    String::from_utf8(bytes.to_vec())
        .map_err(|e| VaultError::General(format!("uncompressed payload is not valid UTF-8: {}", e)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gzip_roundtrips() {
        let text = r#"{"hello":"world","n":42}"#;
        let gz = gzip(text.as_bytes()).unwrap();
        assert_eq!(&gz[0..2], &[0x1f, 0x8b]);
        assert_eq!(gunzip_to_string(&gz).unwrap(), text);
    }

    #[test]
    fn gunzip_rejects_output_over_the_limit() {
        let gz = gzip(&[b'a'; 1025]).unwrap();
        assert!(gunzip_to_string_capped(&gz, 1024).is_err());
        assert_eq!(gunzip_to_string_capped(&gz, 1025).unwrap().len(), 1025);
    }
}
