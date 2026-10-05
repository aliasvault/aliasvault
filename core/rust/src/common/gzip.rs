//! Capped gunzip shared by the vault payload codec and the email parser.

use std::io::Read;

use crate::common::error::{VaultError, VaultResult};

/// gzip magic bytes (RFC 1952) that every gzip stream starts with.
pub(crate) const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

/// Gunzip `bytes`, refusing output above `limit` bytes.
pub(crate) fn gunzip_capped(bytes: &[u8], limit: u64) -> VaultResult<Vec<u8>> {
    let mut out = Vec::new();
    flate2::read::GzDecoder::new(bytes).take(limit + 1).read_to_end(&mut out).map_err(|e| VaultError::General(format!("gunzip failed: {}", e)))?;
    if out.len() as u64 > limit {
        return Err(VaultError::General(format!("decompressed data exceeds the {} byte limit", limit)));
    }
    Ok(out)
}
