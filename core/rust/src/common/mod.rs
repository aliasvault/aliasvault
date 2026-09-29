//! Crate-wide helpers the feature modules share: errors, byte encodings, randomness and timestamps.

pub(crate) mod encoding;
pub mod error;
pub(crate) mod rng;
pub mod timestamp;
