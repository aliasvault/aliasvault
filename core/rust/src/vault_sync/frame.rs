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

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;
    use crate::vault_sync::types::{BlobDownloadResponse, BlobDto, BlobUploadRequest, GetResponse};

    fn frame(header: Value, data: &[u8]) -> Vec<u8> {
        let header = serde_json::to_vec(&header).unwrap();
        [&(header.len() as u32).to_be_bytes()[..], &header, data].concat()
    }

    #[test]
    fn an_upload_keeps_each_ciphertext_out_of_the_json_header() {
        let blob = |hash: &str, bytes: Vec<u8>| BlobDto { hash: hash.to_string(), category: "attachment".to_string(), ciphertext: bytes.into(), encrypted_blob_key: format!("k{}", hash) };
        let mut request = BlobUploadRequest { manifest_id: "m1".to_string(), overwrite: false, blobs: vec![blob("a", vec![1, 2, 3]), blob("b", vec![]), blob("c", vec![4])] };
        let encoded = encode(&mut request).unwrap();

        let header_length = u32::from_be_bytes(encoded[..4].try_into().unwrap()) as usize;
        let header: Value = serde_json::from_slice(&encoded[4..4 + header_length]).unwrap();
        assert_eq!(header["blobs"][0], json!({ "hash": "a", "category": "attachment", "offset": 0, "size": 3, "encryptedBlobKey": "ka" }));
        assert_eq!(&encoded[4 + header_length..], &[1, 2, 3, 4]);

        let decoded: BlobDownloadResponse = decode(&encoded).unwrap();
        assert_eq!(decoded.blobs.iter().map(|b| b.ciphertext.bytes.clone()).collect::<Vec<_>>(), vec![vec![1, 2, 3], vec![], vec![4]]);
    }

    #[test]
    fn a_download_reads_each_part_by_offset_and_skips_what_it_does_not_know() {
        // A newer server: parts in another order, an unknown list with a part of its own, and a part nothing known points at.
        let encoded = frame(
            json!({
                "storageFormat": "manifest",
                "futureList": [{ "offset": 0, "size": 2 }],
                "manifests": [{ "manifestId": "m1", "offset": 5, "size": 3, "futureField": true }, { "manifestId": "m2" }],
                "buckets": [{ "manifestId": "m1", "category": "settings", "offset": 2, "size": 3 }],
            }),
            &[9, 9, 4, 5, 6, 1, 2, 3, 7, 7, 7],
        );
        let snapshot: GetResponse = decode(&encoded).unwrap();
        assert_eq!(snapshot.manifests[0].ciphertext.bytes, vec![1, 2, 3]);
        assert!(!snapshot.manifests[1].has_content());
        assert_eq!(snapshot.buckets[0].ciphertext.bytes, vec![4, 5, 6]);
    }

    #[test]
    fn a_malformed_frame_is_refused() {
        let encoded = frame(json!({ "blobs": [{ "hash": "a", "category": "favicon", "encryptedBlobKey": "ka", "offset": 0, "size": 3 }] }), &[1, 2, 3]);
        assert!(decode::<BlobDownloadResponse>(&encoded).is_ok());
        assert!(decode::<BlobDownloadResponse>(&encoded[..encoded.len() - 1]).is_err(), "a truncated ciphertext");
        assert!(decode::<BlobDownloadResponse>(&[]).is_err(), "no header length");
        assert!(decode::<BlobDownloadResponse>(&[0, 0, 1, 0, b'{']).is_err(), "a header longer than the body");
    }
}
