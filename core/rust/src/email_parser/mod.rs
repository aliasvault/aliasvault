//! Email MIME parsing for source-only stored emails.
use mail_parser::{MessageParser, MimeHeaders};
use serde::Serialize;
use std::io::Read;

use crate::error::{VaultError, VaultResult};

/// A single attachment of a parsed email message. Metadata only: fetch the bytes with
/// [`extract_email_attachment`] using this attachment's index in [`ParsedEmail::attachments`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedEmailAttachment {
    pub filename: String,
    pub mime_type: String,
    /// The decoded attachment size in bytes.
    pub size: u64,
}

/// The result of parsing a raw RFC 822 email source.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedEmail {
    pub html_body: Option<String>,
    pub text_body: Option<String>,
    /// The attachments contained in the message, in the index order [`extract_email_attachment`] expects.
    pub attachments: Vec<ParsedEmailAttachment>,
}

/// Parse a raw RFC 822 email source into its bodies and attachment metadata, transparently
/// gunzipping gzip-compressed input.
pub fn parse_email_source(source: &[u8]) -> VaultResult<ParsedEmail> {
    let raw = decode_email_source(source)?;

    let message = MessageParser::default()
        .parse(raw.as_slice())
        .ok_or_else(|| VaultError::General("Failed to parse email source as a MIME message".to_string()))?;

    let has_html_part = message.html_body.iter().any(|id| message.part(*id).is_some_and(|part| part.is_text_html()));
    let has_text_part = message.text_body.iter().any(|id| message.part(*id).is_some_and(|part| part.is_text() && !part.is_text_html()));
    let html_body = if has_html_part { message.body_html(0).map(|body| body.to_string()) } else { None };
    let text_body = if has_text_part { message.body_text(0).map(|body| body.to_string()) } else { None };

    let attachments = message
        .attachments()
        .map(|part| ParsedEmailAttachment {
            filename: part.attachment_name().unwrap_or_default().to_string(),
            mime_type: part
                .content_type()
                .map(|content_type| match content_type.subtype() {
                    Some(subtype) => format!("{}/{}", content_type.ctype(), subtype),
                    None => content_type.ctype().to_string(),
                })
                .unwrap_or_else(|| "application/octet-stream".to_string()),
            size: part.contents().len() as u64,
        })
        .collect();

    Ok(ParsedEmail { html_body, text_body, attachments })
}

/// Turn a stored email source into the raw RFC 822 message bytes: gunzip the source-only storage
/// format, repair the double encoding of the legacy format. Clients use this for the source view.
pub fn decode_email_source(source: &[u8]) -> VaultResult<Vec<u8>> {
    Ok(match decompress_if_gzip(source)? {
        MaybeDecompressed::Decompressed(raw) => raw,
        MaybeDecompressed::AsIs(raw) => repair_legacy_double_encoding(raw),
    })
}

/// Extract the decoded bytes of a single attachment, identified by its index in
/// [`ParsedEmail::attachments`]. Only that attachment's bytes are returned, so downloading one
/// attachment never marshals the whole message.
pub fn extract_email_attachment(source: &[u8], index: usize) -> VaultResult<Vec<u8>> {
    let raw = decode_email_source(source)?;

    let message = MessageParser::default()
        .parse(raw.as_slice())
        .ok_or_else(|| VaultError::General("Failed to parse email source as a MIME message".to_string()))?;

    // Bind before returning: the attachments iterator borrows `message`, which owns the parsed source.
    let extracted = message.attachments().nth(index).map(|part| part.contents().to_vec());

    extracted.ok_or_else(|| VaultError::General(format!("Email has no attachment at index {}", index)))
}

/// Parse a raw RFC 822 email source and return the result as a JSON string (for uniffi/ffi callers).
pub fn parse_email_source_json(source: &[u8]) -> VaultResult<String> {
    let parsed = parse_email_source(source)?;
    serde_json::to_string(&parsed).map_err(VaultError::from)
}

/// The outcome of the gzip check, which also tells the caller which storage format the source came from.
enum MaybeDecompressed {
    Decompressed(Vec<u8>),
    AsIs(Vec<u8>),
}

/// Gunzip the input when it starts with the gzip magic bytes (0x1f 0x8b), pass it through otherwise.
fn decompress_if_gzip(source: &[u8]) -> VaultResult<MaybeDecompressed> {
    if source.len() < 2 || source[0] != 0x1f || source[1] != 0x8b {
        return Ok(MaybeDecompressed::AsIs(source.to_vec()));
    }

    let mut decoder = flate2::read::GzDecoder::new(source);
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|e| VaultError::General(format!("Failed to gunzip email source: {}", e)))?;
    Ok(MaybeDecompressed::Decompressed(decompressed))
}

/// Undo the double UTF-8 encoding that legacy (pre source-only format) emails were stored with.
///
/// The server (pre-0.31.0) used to persist the raw source as a string via MimeKit's `MimeMessage.ToString()`, which
/// decodes the message bytes as Latin-1 (one char per byte), and then encrypted that string as UTF-8.
/// Every non-ASCII byte was therefore encoded twice on the way in: `é` (`C3 A9`) was stored as `C3 83 C2 A9`.
/// That went unnoticed while clients rendered the separately stored (correctly decoded) html/plain columns,
/// but shows up as incorrect now that the bodies are parsed out of the source itself. Mapping each decoded
/// character back to a single byte reverses it exactly.
///
/// Only input that is valid UTF-8 consisting solely of characters <= U+00FF can be such a round trip, so
/// anything else - including an already correct raw source - is returned unchanged.
fn repair_legacy_double_encoding(raw: Vec<u8>) -> Vec<u8> {
    let text = match std::str::from_utf8(&raw) {
        Ok(text) => text,
        Err(_) => return raw,
    };

    if !text.chars().any(|c| c as u32 > 0x7f) {
        // Pure ASCII: the double encoding was a no-op, so there is nothing to undo.
        return raw;
    }

    if text.chars().any(|c| c as u32 > 0xff) {
        return raw;
    }

    text.chars().map(|c| c as u8).collect()
}

#[cfg(test)]
mod tests;
