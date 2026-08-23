//! Input and output types for the sharing write logic.
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Lower-cased comparison key for a manifest id.
pub(crate) fn id_key(id: &str) -> String {
    id.trim().to_lowercase()
}

/// A shared manifest's key record.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedManifestRecord {
    /// Id of the manifest this record holds the key to.
    pub manifest_id: String,
    /// Salt this manifest's blob hashes are derived with.
    pub salt: String,
    /// Name as recorded on the last pull.
    #[serde(default)]
    pub name: Option<String>,
    /// Whether this account may publish the manifest's email delivery key.
    #[serde(default)]
    pub can_administer: bool,
}

/// Input for resolving a push's write set.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWriteSetRequest {
    /// The vault's own manifest.
    pub personal_manifest_id: String,
    /// Salt the personal manifest's blob hashes are derived with.
    pub personal_manifest_salt: String,
    /// Every manifest the local vault holds rows for.
    #[serde(default)]
    pub stamped_manifest_ids: Vec<String>,
    /// The shared manifests whose grant this session unwrapped.
    #[serde(default)]
    pub opened_manifest_ids: Vec<String>,
    /// The shared-manifest key records this client holds.
    #[serde(default)]
    pub held_records: Vec<SharedManifestRecord>,
    /// What this client renders each manifest as, keyed by manifest id.
    #[serde(default)]
    pub display_names: HashMap<String, String>,
}

/// Why a manifest is left out of the write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WriteSkipReason {
    /// The vault holds no rows for it, so writing would delete all its rows.
    NoRowsInVault,
    /// Its grant did not unwrap in this session.
    KeyDidNotOpen,
}

/// One manifest left out of the write, for the caller to log.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedManifest {
    /// Id of the manifest that was left out.
    pub manifest_id: String,
    /// Why it was left out.
    pub reason: WriteSkipReason,
}

/// One manifest the push writes. Carries no key; the caller looks the VEK up by id.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWriteRecord {
    /// Id of the manifest to write.
    pub manifest_id: String,
    /// Whether this is the vault's own manifest.
    pub is_personal: bool,
    /// Salt this manifest's blob hashes are derived with.
    pub salt: String,
    /// Name to write into the manifest, or none.
    pub name: Option<String>,
    /// Whether this account may publish the manifest's email delivery key.
    pub can_administer: bool,
}

/// The manifests a push writes, personal first, plus what was left out.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWriteSet {
    /// The manifests to write, personal manifest first.
    pub records: Vec<ManifestWriteRecord>,
    /// The manifests left out, with the reason for each.
    pub skipped: Vec<SkippedManifest>,
}

/// Input for splitting a vault by what the account can still open.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAccessRequest {
    /// Every manifest the local vault holds rows for.
    #[serde(default)]
    pub manifest_ids_in_vault: Vec<String>,
    /// The manifests this session can write: the personal one plus every grant that opened.
    #[serde(default)]
    pub writable_manifest_ids: Vec<String>,
    /// The manifests the last snapshot served. Empty means nothing is known yet.
    #[serde(default)]
    pub granted_manifest_ids: Vec<String>,
}

/// What the vault holds but cannot write, and what it holds but has lost access to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestAccessPartition {
    /// Held but not writable, which the caller repairs before pushing.
    pub unwritable: Vec<String>,
    /// Held but no longer served to this account, so its rows are deleted.
    pub lost: Vec<String>,
}
