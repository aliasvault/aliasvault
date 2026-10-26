//! gzip and capped gunzip shared by the vault payload codec and the email parser.

use std::io::{Read, Write};

use flate2::write::GzEncoder;
use flate2::Compression;

use crate::common::error::{VaultError, VaultResult};

/// gzip magic bytes (RFC 1952) that every gzip stream starts with.
const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

/// gzip the given bytes.
pub(crate) fn gzip(bytes: &[u8]) -> VaultResult<Vec<u8>> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).map_err(|e| VaultError::General(format!("gzip write failed: {}", e)))?;
    encoder.finish().map_err(|e| VaultError::General(format!("gzip finish failed: {}", e)))
}

/// Whether `bytes` start with the gzip magic bytes.
pub(crate) fn is_gzip(bytes: &[u8]) -> bool {
    bytes.starts_with(&GZIP_MAGIC)
}

/// Gunzip `bytes`, refusing output above `limit` bytes.
pub(crate) fn gunzip(bytes: &[u8], limit: u64) -> VaultResult<Vec<u8>> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(bytes).take(limit + 1).read_to_end(&mut out).map_err(|e| VaultError::General(format!("gunzip failed: {}", e)))?;
    if out.len() as u64 > limit {
        return Err(VaultError::General(format!("decompressed data exceeds the {} byte limit", limit)));
    }
    Ok(out)
}
