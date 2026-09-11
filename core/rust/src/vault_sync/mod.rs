//! The vault sync engine that all AliasVault clients use to synchronize their vaults with the server.

pub(crate) mod db;
pub(crate) mod email_routing;
mod engine;
pub mod errors;
pub(crate) mod http;
pub(crate) mod keys;
mod legacy;
mod merge;
mod pull;
mod push;
pub mod session;
pub(crate) mod state;
pub mod types;
pub mod version;

#[cfg(test)]
mod tests;

pub use errors::{ErrorCode, Failure, LogoutReason, SyncError};
pub use session::SyncSession;
pub use types::{Command, CommandKind, Db, FullSyncResult, HttpMethod, LogLevel, MigrateManifestResult, MigrationKind, MigrationStatusResult, SessionOutcome, SessionUpdates, SqlStatement, StatusCheckResult, SyncOperation, SyncRequest};
