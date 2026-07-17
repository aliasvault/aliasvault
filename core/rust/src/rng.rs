//! Shared RNG helpers used by the generator modules (password, identity).

use rand::rngs::StdRng;
use rand::{RngCore, SeedableRng};

/// Build the RNG used for generation.
///
/// If `seed` is a valid 64-character hex string (32 bytes), the RNG is deterministically
/// seeded from it. Otherwise a fresh 32-byte seed is drawn from the OS CSPRNG.
pub(crate) fn make_rng(seed: Option<&str>) -> StdRng {
    if let Some(bytes) = seed.and_then(parse_seed_hex) {
        return StdRng::from_seed(bytes);
    }

    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    StdRng::from_seed(bytes)
}

/// Parse a 64-character hex string into a 32-byte seed, or `None` if it is malformed.
fn parse_seed_hex(hex: &str) -> Option<[u8; 32]> {
    if hex.len() != 64 {
        return None;
    }
    let mut bytes = [0u8; 32];
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(bytes)
}

/// Get an unbiased random index in `0..max` using rejection sampling over the given CSPRNG.
/// Handles modulo bias by rejecting values above the largest multiple of `max` that fits in a `u32`.
pub(crate) fn unbiased_index<R: RngCore + ?Sized>(rng: &mut R, max: usize) -> usize {
    debug_assert!(max > 0, "unbiased_index requires max > 0");
    if max <= 1 {
        return 0;
    }

    let max = max as u64;
    let limit = ((1u64 << 32) / max) * max;

    loop {
        let value = rng.next_u32() as u64;
        if value < limit {
            return (value % max) as usize;
        }
    }
}
