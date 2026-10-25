use crate::common::encoding::*;

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
fn base64url_round_trips_without_padding() {
    let bytes = vec![0xfbu8, 0xff, 0xfe];
    let text = base64url_encode(&bytes);
    assert_eq!(text, "-__-");
    assert_eq!(base64url_decode(&text).unwrap(), bytes);
    assert!(base64url_decode("+//+").is_err());
}

#[test]
fn uuid_text_form_is_lowercase_and_grouped() {
    let bytes = [0xABu8; 16];
    assert_eq!(format_uuid(&bytes), "abababab-abab-abab-abab-abababababab");
    let stamped = uuid_from_bytes([0xFFu8; 16], 4);
    assert_eq!(&stamped[14..15], "4");
    assert!(matches!(&stamped[19..20], "8" | "9" | "a" | "b"));
}
