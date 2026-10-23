use crate::vault_codec::compress::*;

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
