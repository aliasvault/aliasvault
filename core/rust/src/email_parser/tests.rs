use super::*;
use std::io::Write;

const PLAIN_EMAIL: &str = "From: Alice <alice@example.com>\r\n\
To: bob@example.org\r\n\
Subject: Hello\r\n\
Date: Mon, 10 Aug 2026 12:00:00 +0000\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
\r\n\
Hello Bob, this is a plain text email.\r\n";

const MULTIPART_EMAIL: &str = "From: Alice <alice@example.com>\r\n\
To: bob@example.org\r\n\
Subject: Multipart\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"outer\"\r\n\
\r\n\
--outer\r\n\
Content-Type: multipart/alternative; boundary=\"inner\"\r\n\
\r\n\
--inner\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
\r\n\
Plain version.\r\n\
--inner\r\n\
Content-Type: text/html; charset=utf-8\r\n\
\r\n\
<html><body><p>Html version.</p></body></html>\r\n\
--inner--\r\n\
--outer\r\n\
Content-Type: application/pdf\r\n\
Content-Disposition: attachment; filename=\"report.pdf\"\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
JVBERi1oZWxsbw==\r\n\
--outer--\r\n";

const UNICODE_EMAIL: &str = "From: Alice <alice@example.com>\r\n\
To: bob@example.org\r\n\
Subject: Unicode\r\n\
MIME-Version: 1.0\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
Content-Transfer-Encoding: 8bit\r\n\
\r\n\
Special symbols: é€ñ ∑ • ≈\r\n";

fn gzip(data: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap()
}

/// Reproduce how the server used to store a legacy email source: the raw bytes read back as Latin-1
/// (MimeKit's `MimeMessage.ToString()`) and then encoded as UTF-8 again when the string was encrypted.
fn legacy_double_encode(raw: &[u8]) -> Vec<u8> {
    raw.iter().map(|byte| *byte as char).collect::<String>().into_bytes()
}

#[test]
fn parses_plain_text_email() {
    let parsed = parse_email_source(PLAIN_EMAIL.as_bytes()).unwrap();

    assert_eq!(parsed.text_body.as_deref(), Some("Hello Bob, this is a plain text email.\r\n"));
    assert!(parsed.html_body.is_none(), "plain-only email must not get a synthesized html body");
    assert!(parsed.attachments.is_empty());
}

#[test]
fn parses_multipart_email_with_attachment() {
    let parsed = parse_email_source(MULTIPART_EMAIL.as_bytes()).unwrap();

    assert!(parsed.html_body.as_deref().unwrap().contains("<p>Html version.</p>"));
    assert!(parsed.text_body.as_deref().unwrap().contains("Plain version."));
    assert_eq!(parsed.attachments.len(), 1);

    let attachment = &parsed.attachments[0];
    assert_eq!(attachment.filename, "report.pdf");
    assert_eq!(attachment.mime_type, "application/pdf");
    assert_eq!(attachment.size, 10);
    assert_eq!(extract_email_attachment(MULTIPART_EMAIL.as_bytes(), 0).unwrap(), b"%PDF-hello");
}

#[test]
fn gunzips_compressed_source_transparently() {
    let compressed = gzip(MULTIPART_EMAIL.as_bytes());
    assert_eq!(&compressed[..2], &[0x1f, 0x8b], "gzip output must carry the magic bytes clients sniff");

    let parsed = parse_email_source(&compressed).unwrap();
    assert!(parsed.html_body.as_deref().unwrap().contains("<p>Html version.</p>"));
    assert_eq!(parsed.attachments.len(), 1);
    let decoded = decode_email_source(&compressed).unwrap();
    assert!(String::from_utf8_lossy(&decoded).contains("Subject: Multipart"), "source view must show the decompressed source");
}

#[test]
fn html_only_email_has_no_synthesized_text_body() {
    let email = "From: a@b.c\r\nTo: d@e.f\r\nSubject: X\r\nContent-Type: text/html\r\n\r\n<p>Hi</p>\r\n";
    let parsed = parse_email_source(email.as_bytes()).unwrap();

    assert!(parsed.html_body.is_some());
    assert!(parsed.text_body.is_none(), "html-only email must not get a synthesized text body");
}

#[test]
fn legacy_double_encoded_source_is_repaired() {
    let stored = legacy_double_encode(UNICODE_EMAIL.as_bytes());
    assert_ne!(stored, UNICODE_EMAIL.as_bytes(), "the fixture must actually be double encoded");

    let parsed = parse_email_source(&stored).unwrap();

    assert_eq!(parsed.text_body.as_deref(), Some("Special symbols: é€ñ ∑ • ≈\r\n"));

    let decoded = decode_email_source(&stored).unwrap();
    assert_eq!(decoded, UNICODE_EMAIL.as_bytes(), "the source view must show the repaired bytes");
}

#[test]
fn legacy_double_encoded_attachment_bytes_are_repaired() {
    let email = "From: a@b.c\r\n\
To: d@e.f\r\n\
Subject: Attachment\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"b\"\r\n\
\r\n\
--b\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
\r\n\
Body\r\n\
--b\r\n\
Content-Type: text/plain; charset=utf-8\r\n\
Content-Disposition: attachment; filename=\"notes.txt\"\r\n\
Content-Transfer-Encoding: 8bit\r\n\
\r\n\
Prijs: 10€\r\n\
--b--\r\n";

    let parsed = parse_email_source(&legacy_double_encode(email.as_bytes())).unwrap();

    assert_eq!(parsed.attachments.len(), 1);
    let content = extract_email_attachment(&legacy_double_encode(email.as_bytes()), 0).unwrap();
    assert_eq!(String::from_utf8(content).unwrap().trim_end(), "Prijs: 10€");
}

#[test]
fn compressed_source_is_never_repaired() {
    // Source-only stored emails hold the message bytes verbatim: applying the legacy repair to them
    // would map each decoded scalar back to a single byte and mangle every non-ASCII character.
    let parsed = parse_email_source(&gzip(UNICODE_EMAIL.as_bytes())).unwrap();

    assert_eq!(parsed.text_body.as_deref(), Some("Special symbols: é€ñ ∑ • ≈\r\n"));
}

#[test]
fn ascii_only_source_is_passed_through_unchanged() {
    // ASCII survives the legacy double encoding untouched, so the repair must be a no-op for it.
    assert_eq!(decode_email_source(PLAIN_EMAIL.as_bytes()).unwrap(), PLAIN_EMAIL.as_bytes());
}

#[test]
fn decodes_legacy_cjk_charsets() {
    // Requires mail-parser's full_encoding feature: without it these charsets have no decoder and
    // the body degrades to replacement characters. MimeKit decoded them before the client-side parse.
    let cases: [(&str, &[u8], &str); 3] = [
        ("shift_jis", b"\x83n\x83\x8d\x81[", "ハロー"),
        ("gbk", b"\xc4\xe3\xba\xc3", "你好"),
        ("euc-kr", b"\xbe\xc8\xb3\xe7", "안녕"),
    ];

    for (charset, body, expected) in cases {
        let mut email = format!("From: a@b.c\r\nTo: d@e.f\r\nSubject: X\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset={}\r\nContent-Transfer-Encoding: 8bit\r\n\r\n", charset).into_bytes();
        email.extend_from_slice(body);

        let parsed = parse_email_source(&email).unwrap();
        assert_eq!(parsed.text_body.as_deref(), Some(expected), "charset {} did not decode", charset);
    }
}

#[test]
fn extracts_attachments_by_index() {
    let email = "From: a@b.c\r\n\
To: d@e.f\r\n\
Subject: Two\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"b\"\r\n\
\r\n\
--b\r\n\
Content-Type: text/plain\r\n\
\r\n\
Body\r\n\
--b\r\n\
Content-Type: application/octet-stream\r\n\
Content-Disposition: attachment; filename=\"first.bin\"\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
Zmlyc3Q=\r\n\
--b\r\n\
Content-Type: application/octet-stream\r\n\
Content-Disposition: attachment; filename=\"second.bin\"\r\n\
Content-Transfer-Encoding: base64\r\n\
\r\n\
c2Vjb25k\r\n\
--b--\r\n";

    let parsed = parse_email_source(email.as_bytes()).unwrap();
    assert_eq!(parsed.attachments.iter().map(|a| a.filename.as_str()).collect::<Vec<_>>(), ["first.bin", "second.bin"]);

    assert_eq!(extract_email_attachment(email.as_bytes(), 0).unwrap(), b"first");
    assert_eq!(extract_email_attachment(email.as_bytes(), 1).unwrap(), b"second");
    assert!(extract_email_attachment(email.as_bytes(), 2).is_err(), "an out of range index must error, not return empty bytes");
}

#[test]
fn extracts_attachments_from_compressed_source() {
    let compressed = gzip(MULTIPART_EMAIL.as_bytes());

    assert_eq!(extract_email_attachment(&compressed, 0).unwrap(), b"%PDF-hello");
}

#[test]
fn invalid_gzip_input_errors() {
    let bogus = [0x1f, 0x8b, 0x00, 0x01, 0x02];
    assert!(parse_email_source(&bogus).is_err());
}

#[test]
fn json_output_uses_camel_case_fields() {
    let json = parse_email_source_json(MULTIPART_EMAIL.as_bytes()).unwrap();
    assert!(json.contains("\"htmlBody\""));
    assert!(json.contains("\"textBody\""));
    assert!(json.contains("\"mimeType\""));
    assert!(!json.contains("\"contentBase64\""), "attachment bytes must not ride along in the parse result");
}
