//! The vault sync engine that all AliasVault clients use to synchronize their vaults with the server.

mod blob_keys;
pub(crate) mod db;
mod email_routing;
mod engine;
pub(crate) mod errors;
mod http;
mod keys;
mod legacy;
mod merge;
mod pull;
mod push;
mod session;
mod sharing;
pub(crate) mod state;
pub(crate) mod types;

#[cfg(test)]
mod tests;

pub use session::SyncSession;
