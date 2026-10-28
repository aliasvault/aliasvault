//! Email MIME parsing: the bodies and attachment metadata of a stored RFC 822 source.

#[cfg(test)]
mod tests;

use mail_parser::{GetHeader, Message, MessageParser, MessagePart, MimeHeaders};
use serde::Serialize;

use crate::common::error::{VaultError, VaultResult};
use crate::common::gzip::{gunzip, is_gzip};

/// Header the server stamps on an attachment whose body it detached from the source, carrying the index that body is stored under.
const DETACHED_PART_INDEX_HEADER: &str = "X-AliasVault-Part";

/// Header the server stamps on a detached attachment, carrying its decoded size.
const DETACHED_PART_LENGTH_HEADER: &str = "X-AliasVault-Detached-Length";

/// Cap on a gunzipped email source or detached part, with headroom over the ~14 MB the SMTP service accepts.
const MAX_DECOMPRESSED_EMAIL_BYTES: u64 = 64 * 1024 * 1024;

/// An attachment of a parsed email, metadata only.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedEmailAttachment {
    pub filename: String,
    pub mime_type: String,
    /// The decoded size in bytes.
    pub size: u64,
    /// Whether the body lives outside the source and has to be fetched separately.
    pub detached: bool,
    /// The index a detached body is stored under; None while the body is inline.
    pub part_index: Option<u32>,
}

/// The bodies and attachments of a parsed email.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedEmail {
    pub html_body: Option<String>,
    pub text_body: Option<String>,
    /// In the order [`extract_email_attachment`] indexes them.
    pub attachments: Vec<ParsedEmailAttachment>,
}

/// Parse a stored email source into its bodies and attachment metadata.
pub fn parse_email_source(source: &[u8]) -> VaultResult<ParsedEmail> {
    let raw = decode_email_source(source)?;
    let message = parse_message(&raw)?;

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
                // A detached body is not in the source, so its size comes from the stamped header.
                size: header_u64(part, DETACHED_PART_LENGTH_HEADER).unwrap_or_else(|| part.contents().len() as u64),
                detached: part_index.is_some(),
                part_index,
            }
        })
        .collect();

    Ok(ParsedEmail { html_body, text_body, attachments })
}

/// The raw RFC 822 bytes of a stored email source.
pub fn decode_email_source(source: &[u8]) -> VaultResult<Vec<u8>> {
    if is_gzip(source) {
        return gunzip(source, MAX_DECOMPRESSED_EMAIL_BYTES);
    }
    // LEGACY: sources stored before 0.31.0 are not gzipped and are double encoded. TODO: remove once no such sources are served.
    Ok(repair_legacy_double_encoding(source.to_vec()))
}

/// The decoded bytes of the attachment at `index`, with its detached body when it has one.
pub fn extract_email_attachment(source: &[u8], index: usize, detached_body: Option<&[u8]>) -> VaultResult<Vec<u8>> {
    let raw = decode_email_source(source)?;

    // The parsed message borrows `raw`, so what the splice needs is read out before `raw` is used again.
    let (body_range, detached_body) = {
        let message = parse_message(&raw)?;
        let part = attachment_at(&message, index)?;

        match (detached_part_index(part).is_some(), detached_body) {
            (false, _) => return Ok(part.contents().to_vec()),
            (true, None) => return Err(VaultError::General(format!("Attachment at index {} is detached; its body has to be fetched separately", index))),
            (true, Some(body)) => (part.offset_body as usize..part.offset_end as usize, body),
        }
    };

    let body = gunzip(detached_body, MAX_DECOMPRESSED_EMAIL_BYTES)?;
    let mut spliced = Vec::with_capacity(raw.len() + body.len());
    spliced.extend_from_slice(&raw[..body_range.start]);
    spliced.extend_from_slice(&body);
    spliced.extend_from_slice(&raw[body_range.end..]);

    let message = parse_message(&spliced)?;
    Ok(attachment_at(&message, index)?.contents().to_vec())
}

/// [`parse_email_source`] as JSON, for the uniffi bindings.
pub fn parse_email_source_json(source: &[u8]) -> VaultResult<String> {
    Ok(serde_json::to_string(&parse_email_source(source)?)?)
}

/// Parse raw RFC 822 bytes into a message.
fn parse_message(raw: &[u8]) -> VaultResult<Message<'_>> {
    MessageParser::default().parse(raw).ok_or_else(|| VaultError::General("Failed to parse email source as a MIME message".to_string()))
}

/// The attachment at `index` in the message's attachment list.
fn attachment_at<'x>(message: &'x Message<'x>, index: usize) -> VaultResult<&'x MessagePart<'x>> {
    message.attachments().nth(index).ok_or_else(|| VaultError::General(format!("Email has no attachment at index {}", index)))
}

/// The index a detached attachment's body is stored under, or None while the body is inline.
fn detached_part_index(part: &MessagePart<'_>) -> Option<u32> {
    header_u64(part, DETACHED_PART_INDEX_HEADER).and_then(|index| u32::try_from(index).ok())
}

/// A header of a part as an unsigned number, or None when absent or not numeric.
fn header_u64(part: &MessagePart<'_>, name: &str) -> Option<u64> {
    part.headers.header(name).and_then(|header| header.value().as_text()).and_then(|value| value.trim().parse::<u64>().ok())
}

/// LEGACY: undo the Latin-1 then UTF-8 double encoding of sources stored before 0.31.0, where `C3 A9` became `C3 83 C2 A9`.
/// A no-op for bytes that are not valid UTF-8 or contain a character above U+00FF, such as a correct source.
fn repair_legacy_double_encoding(raw: Vec<u8>) -> Vec<u8> {
    let text = match std::str::from_utf8(&raw) {
        Ok(text) => text,
        Err(_) => return raw,
    };

    // Pure ASCII was not changed by the double encoding.
    if !text.chars().any(|c| c as u32 > 0x7f) {
        return raw;
    }

    if text.chars().any(|c| c as u32 > 0xff) {
        return raw;
    }

    text.chars().map(|c| c as u8).collect()
}
