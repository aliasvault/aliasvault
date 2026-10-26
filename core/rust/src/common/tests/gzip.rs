use crate::common::gzip::*;

#[test]
fn gzip_round_trips() {
    let text = r#"{"hello":"world","n":42}"#;
    let gz = gzip(text.as_bytes()).unwrap();
    assert!(is_gzip(&gz));
    assert_eq!(gunzip(&gz, 1024).unwrap(), text.as_bytes());
}

#[test]
fn rejects_input_that_is_not_gzip() {
    assert!(!is_gzip(b"{}"));
    assert!(gunzip(b"{}", 1024).is_err());
}

#[test]
fn rejects_output_over_the_limit() {
    let gz = gzip(&[b'a'; 1025]).unwrap();
    assert!(gunzip(&gz, 1024).is_err());
    assert_eq!(gunzip(&gz, 1025).unwrap().len(), 1025);
}
