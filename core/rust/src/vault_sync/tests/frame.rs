use serde_json::{json, Value};

use crate::vault_sync::frame::*;
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
