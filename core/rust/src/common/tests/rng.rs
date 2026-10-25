use crate::common::rng::*;
use rand::rngs::StdRng;
use rand::SeedableRng;

fn seeded_rng() -> StdRng {
    StdRng::from_seed([7u8; 32])
}

#[test]
fn unbiased_index_stays_in_range() {
    let mut rng = seeded_rng();
    for max in [2usize, 3, 10, 36, 100] {
        for _ in 0..1000 {
            assert!(unbiased_index(&mut rng, max) < max);
        }
    }
}

#[test]
fn unbiased_index_handles_edge_maxes() {
    let mut rng = seeded_rng();
    // max <= 1 short-circuits to 0.
    assert_eq!(unbiased_index(&mut rng, 1), 0);

    // Powers of two divide 2^64 evenly (rem == 0): must accept immediately, never hang.
    for shift in [1u32, 8, 16] {
        let max = 1usize << shift;
        assert!(unbiased_index(&mut rng, max) < max);
    }

    #[cfg(target_pointer_width = "64")]
    {
        assert!(unbiased_index(&mut rng, 1usize << 62) < (1usize << 62));
        let big = (u32::MAX as usize) + 1;
        assert!(unbiased_index(&mut rng, big) < big);
        assert!(unbiased_index(&mut rng, usize::MAX) < usize::MAX);
    }
}

#[test]
fn seed_must_be_exactly_32_bytes_of_hex() {
    assert!(parse_seed_hex(&"ab".repeat(32)).is_some());
    assert!(parse_seed_hex(&"ab".repeat(31)).is_none());
    assert!(parse_seed_hex(&"zz".repeat(32)).is_none());
}
