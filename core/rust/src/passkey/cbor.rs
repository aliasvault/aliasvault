//! CBOR encodings the authenticator emits (RFC 8949): definite-length maps, small integers, text and byte strings.

/// The head of a data item: major type plus its argument, in the shortest form.
fn head(major: u8, argument: u64) -> Vec<u8> {
    let major = major << 5;
    match argument {
        0..=23 => vec![major | argument as u8],
        24..=0xff => vec![major | 24, argument as u8],
        0x100..=0xffff => {
            let mut out = vec![major | 25];
            out.extend_from_slice(&(argument as u16).to_be_bytes());
            out
        }
        0x1_0000..=0xffff_ffff => {
            let mut out = vec![major | 26];
            out.extend_from_slice(&(argument as u32).to_be_bytes());
            out
        }
        _ => {
            let mut out = vec![major | 27];
            out.extend_from_slice(&argument.to_be_bytes());
            out
        }
    }
}

/// An integer.
pub(super) fn int(value: i64) -> Vec<u8> {
    if value >= 0 {
        head(0, value as u64)
    } else {
        head(1, (-1 - value) as u64)
    }
}

/// A byte string.
pub(super) fn bytes(value: &[u8]) -> Vec<u8> {
    let mut out = head(2, value.len() as u64);
    out.extend_from_slice(value);
    out
}

/// A text string.
pub(super) fn text(value: &str) -> Vec<u8> {
    let mut out = head(3, value.len() as u64);
    out.extend_from_slice(value.as_bytes());
    out
}

/// A map of already-encoded keys and values, in the given order.
pub(super) fn map(entries: &[(Vec<u8>, Vec<u8>)]) -> Vec<u8> {
    let mut out = head(5, entries.len() as u64);
    for (key, value) in entries {
        out.extend_from_slice(key);
        out.extend_from_slice(value);
    }
    out
}
