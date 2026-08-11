//! Email MIME parsing for source-only stored emails.
use mail_parser::{GetHeader, Message, MessageParser, MessagePart, MimeHeaders};
use serde::Serialize;
use std::io::Read;

use crate::error::{VaultError, VaultResult};

/// Header the server stamps on an attachment whose body it detached from the source at ingest, carrying the
/// index that body is stored and requested under. Reading the index from the message itself keeps it
/// independent of how any given MIME parser happens to order a message's attachments.
const DETACHED_PART_INDEX_HEADER: &str = "X-AliasVault-Part";

/// Header the server stamps on a detached attachment carrying its decoded size, so the size can be shown in
/// the attachment list without downloading the body.
const DETACHED_PART_LENGTH_HEADER: &str = "X-AliasVault-Detached-Length";

/// A single attachment of a parsed email message. Metadata only: fetch the bytes with
/// [`extract_email_attachment`] using this attachment's index in [`ParsedEmail::attachments`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedEmailAttachment {
    pub filename: String,
    pub mime_type: String,
    /// The decoded attachment size in bytes.
    pub size: u64,
    /// Whether this attachment's body lives outside the message source and has to be fetched separately
    /// before [`extract_email_attachment`] can return its bytes.
    pub detached: bool,
    /// The index the detached body is stored under, to request it by. `None` for an attachment whose body
    /// is still inline in the source.
    pub part_index: Option<u32>,
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
        .map(|part| {
            let part_index = detached_part_index(part);
            ParsedEmailAttachment {
                filename: part.attachment_name().unwrap_or_default().to_string(),
                mime_type: part
                    .content_type()
                    .map(|content_type| match content_type.subtype() {
                        Some(subtype) => format!("{}/{}", content_type.ctype(), subtype),
                        None => content_type.ctype().to_string(),
                    })
                    .unwrap_or_else(|| "application/octet-stream".to_string()),
                // The real size of a detached attachment comes from the header the server stamped on it.
                size: header_u64(part, DETACHED_PART_LENGTH_HEADER).unwrap_or_else(|| part.contents().len() as u64),
                detached: part_index.is_some(),
                part_index,
            }
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
/// [`ParsedEmail::attachments`].
pub fn extract_email_attachment(source: &[u8], index: usize, detached_body: Option<&[u8]>) -> VaultResult<Vec<u8>> {
    let raw = decode_email_source(source)?;

    // Resolve what the attachment needs before splicing: the parsed message borrows `raw`, so nothing that
    // borrows it may outlive this block.
    let body_range = {
        let message = parse_message(&raw)?;
        let part = attachment_at(&message, index)?;

        match (detached_part_index(part).is_some(), detached_body) {
            (false, _) => return Ok(part.contents().to_vec()),
            (true, None) => {
                return Err(VaultError::General(format!(
                    "Attachment at index {} was detached from the source at ingest; its body has to be fetched separately",
                    index
                )))
            }
            (true, Some(_)) => part.offset_body as usize..part.offset_end as usize,
        }
    };

    let body = decode_detached_part(detached_body.unwrap_or_default())?;
    let mut spliced = Vec::with_capacity(raw.len() + body.len());
    spliced.extend_from_slice(&raw[..body_range.start]);
    spliced.extend_from_slice(&body);
    spliced.extend_from_slice(&raw[body_range.end..]);

    let message = parse_message(&spliced)?;
    let extracted = attachment_at(&message, index)?.contents().to_vec();

    Ok(extracted)
}

/// Parse a raw RFC 822 email source and return the result as a JSON string (for uniffi/ffi callers).
pub fn parse_email_source_json(source: &[u8]) -> VaultResult<String> {
    let parsed = parse_email_source(source)?;
    serde_json::to_string(&parsed).map_err(VaultError::from)
}

/// Parse raw RFC 822 bytes into a message, turning the parser's `None` into a proper error.
fn parse_message(raw: &[u8]) -> VaultResult<Message<'_>> {
    MessageParser::default()
        .parse(raw)
        .ok_or_else(|| VaultError::General("Failed to parse email source as a MIME message".to_string()))
}

/// Look up an attachment by its index in the message's attachment list.
fn attachment_at<'x>(message: &'x Message<'x>, index: usize) -> VaultResult<&'x MessagePart<'x>> {
    message
        .attachments()
        .nth(index)
        .ok_or_else(|| VaultError::General(format!("Email has no attachment at index {}", index)))
}

/// Read the index a detached attachment's body is stored under, or `None` when the body is still inline.
fn detached_part_index(part: &MessagePart<'_>) -> Option<u32> {
    header_u64(part, DETACHED_PART_INDEX_HEADER).and_then(|index| u32::try_from(index).ok())
}

/// Read a header of a part as an unsigned number, ignoring it when absent or not numeric.
fn header_u64(part: &MessagePart<'_>, name: &str) -> Option<u64> {
    part.headers
        .header(name)
        .and_then(|header| header.value().as_text())
        .and_then(|value| value.trim().parse::<u64>().ok())
}

/// Decompress a stored detached attachment body. Unlike the message source there is no legacy encoding to
/// repair: detached parts only exist in the source-only storage format.
fn decode_detached_part(body: &[u8]) -> VaultResult<Vec<u8>> {
    Ok(match decompress_if_gzip(body)? {
        MaybeDecompressed::Decompressed(bytes) | MaybeDecompressed::AsIs(bytes) => bytes,
    })
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
