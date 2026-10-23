//! The binary body of the v2 vault transfers: a 4-byte big-endian header length, a JSON header, then the raw
//! ciphertexts. Each header entry that carries a ciphertext gives its `offset` (counted from the first byte after the
//! header) and `size`, so a reader skips entries and bytes it does not know, as it skips unknown JSON fields.
//! Mirrors the server's `BinaryFrame`.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use super::errors::{SyncError, SyncResult};

/// A ciphertext sent after the frame header; the header carries its `offset` and `size`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FramePart {
    #[serde(default)]
    pub offset: usize,
    #[serde(default)]
    pub size: usize,
    #[serde(skip)]
    pub bytes: Vec<u8>,
}

impl From<Vec<u8>> for FramePart {
    fn from(bytes: Vec<u8>) -> Self {
        Self { offset: 0, size: bytes.len(), bytes }
    }
}

/// A frame header: the entries whose ciphertext follows it, in frame order.
pub(crate) trait FrameBody {
    fn parts(&mut self) -> Vec<&mut FramePart>;
}

/// Lay out `body` as a frame, setting each part's `offset` and `size`.
pub(crate) fn encode<B: FrameBody + Serialize>(body: &mut B) -> SyncResult<Vec<u8>> {
    let mut data_length = 0;
    for part in body.parts() {
        part.offset = data_length;
        part.size = part.bytes.len();
        data_length += part.size;
    }
    let header = serde_json::to_vec(body)?;
    let mut frame = Vec::with_capacity(4 + header.len() + data_length);
    frame.extend_from_slice(&(header.len() as u32).to_be_bytes());
    frame.extend_from_slice(&header);
    for part in body.parts() {
        frame.extend_from_slice(&part.bytes);
    }
    Ok(frame)
}

/// Read a frame back into its header type, filling each part with its ciphertext.
pub(crate) fn decode<T: FrameBody + DeserializeOwned>(frame: &[u8]) -> SyncResult<T> {
    let malformed = |reason: &str| SyncError::ServerVaultUnreadable(format!("binary response is malformed: {}", reason));
    let (length, rest) = frame.split_first_chunk::<4>().ok_or_else(|| malformed("no header length"))?;
    let (header, data) = rest.split_at_checked(u32::from_be_bytes(*length) as usize).ok_or_else(|| malformed("header exceeds the body"))?;
    let mut body: T = serde_json::from_slice(header).map_err(|e| malformed(&e.to_string()))?;
    for part in body.parts() {
        let bytes = part.offset.checked_add(part.size).and_then(|end| data.get(part.offset..end)).ok_or_else(|| malformed("a ciphertext exceeds the body"))?;
        part.bytes = bytes.to_vec();
    }
    Ok(body)
}
