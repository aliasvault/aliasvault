//! Randomness: the one OS entropy entry point and the seedable RNG the generator modules use.

use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};

/// Fill a buffer from the operating system's CSPRNG.
pub(crate) fn fill_random(dest: &mut [u8]) {
    getrandom::fill(dest).expect("the OS CSPRNG is unavailable");
}

/// `len` fresh bytes from the operating system's CSPRNG.
pub(crate) fn random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    fill_random(&mut bytes);
    bytes
}

/// A fixed-size array of fresh bytes from the operating system's CSPRNG.
pub(crate) fn random_array<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    fill_random(&mut bytes);
    bytes
}

/// Build the RNG used for generation.
///
/// If `seed` is a valid 64-character hex string (32 bytes), the RNG is deterministically
/// seeded from it. Otherwise a fresh 32-byte seed is drawn from the OS CSPRNG.
pub(crate) fn make_rng(seed: Option<&str>) -> StdRng {
    if let Some(bytes) = seed.and_then(parse_seed_hex) {
        return StdRng::from_seed(bytes);
    }

    let mut bytes = [0u8; 32];
    fill_random(&mut bytes);
    StdRng::from_seed(bytes)
}

/// Parse a 64-character hex string into a 32-byte seed, or `None` if it is malformed.
pub(super) fn parse_seed_hex(hex: &str) -> Option<[u8; 32]> {
    crate::common::encoding::hex_decode(hex)?.try_into().ok()
}

/// Get an unbiased random index in `0..max` using rejection sampling over the given CSPRNG.
/// Handles modulo bias by rejecting values above the largest multiple of `max` that fits in a `u64`.
pub(crate) fn unbiased_index<R: Rng + ?Sized>(rng: &mut R, max: usize) -> usize {
    debug_assert!(max > 0, "unbiased_index requires max > 0");
    if max <= 1 {
        return 0;
    }

    let max = max as u64;
    let rem = max.wrapping_neg() % max;

    loop {
        let value = rng.next_u64();
        if rem == 0 || value < rem.wrapping_neg() {
            return (value % max) as usize;
        }
    }
}
