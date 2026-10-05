//! Crate-wide helpers the feature modules share: errors, byte encodings, gzip, randomness and timestamps.

pub(crate) mod encoding;
pub mod error;
pub(crate) mod gzip;
pub(crate) mod rng;
pub mod timestamp;
