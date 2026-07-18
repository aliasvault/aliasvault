//! gzip compress / gunzip decompress.

use std::io::{Read, Write};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;

use crate::error::{VaultError, VaultResult};

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

/// Decompress gzipped bytes into a UTF-8 string.
pub fn gunzip_to_string(bytes: &[u8]) -> VaultResult<String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut out = String::new();
    decoder
        .read_to_string(&mut out)
        .map_err(|e| VaultError::General(format!("gunzip failed: {}", e)))?;
    Ok(out)
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
}
