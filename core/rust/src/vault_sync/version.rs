//! Version rules: server support, and the frozen legacy sqlite-blob vault version chain.

/// Whether `version1 >= version2` under the client's SemVer rules: a pre-release sorts below its release, and
/// two pre-releases compare lexically.
pub fn version_gte(version1: &str, version2: &str) -> bool {
    let (core1, pre1) = split(version1);
    let (core2, pre2) = split(version2);
    let parts1: Vec<u64> = core1.split('.').map(|part| part.parse().unwrap_or(0)).collect();
    let parts2: Vec<u64> = core2.split('.').map(|part| part.parse().unwrap_or(0)).collect();

    for index in 0..parts1.len().max(parts2.len()) {
        let part1 = parts1.get(index).copied().unwrap_or(0);
        let part2 = parts2.get(index).copied().unwrap_or(0);
        if part1 > part2 {
            return true;
        }
        if part1 < part2 {
            return false;
        }
    }

    match (pre1, pre2) {
        (None, Some(_)) => true,
        (Some(_), None) => false,
        (None, None) => true,
        (Some(a), Some(b)) => a >= b,
    }
}

fn split(version: &str) -> (&str, Option<&str>) {
    match version.split_once('-') {
        Some((core, pre)) if !pre.is_empty() => (core, Some(pre)),
        Some((core, _)) => (core, None),
        None => (version, None),
    }
}

/// The frozen sqlite-blob upgrade chain: (revision, data version). It ends at 2.0.0, the first schema compatible
/// with manifest-v1; later schema changes ship through the full schema only which is used by every materilization directly.
const LEGACY_VAULT_VERSIONS: &[(u32, &str)] = &[
    (1, "1.0.0"),
    (2, "1.0.1"),
    (3, "1.0.2"),
    (4, "1.1.0"),
    (5, "1.2.0"),
    (6, "1.3.0"),
    (7, "1.3.1"),
    (8, "1.4.0"),
    (9, "1.4.1"),
    (10, "1.5.0"),
    (11, "1.6.0"),
    (12, "1.7.0"),
    (13, "2.0.0"),
];

/// The revision of the last entry in the legacy chain.
pub fn latest_legacy_revision() -> u32 {
    LEGACY_VAULT_VERSIONS.last().map(|(revision, _)| *revision).unwrap_or(0)
}

/// The data version embedded in an EF migration id (`20250101000000_2.0.0-Name`).
pub fn extract_version_from_migration_id(migration_id: &str) -> Option<String> {
    let start = migration_id.find('_')? + 1;
    let rest = &migration_id[start..];
    let end = rest.find('-')?;
    let candidate = &rest[..end];
    let parts: Vec<&str> = candidate.split('.').collect();
    if parts.len() == 3 && parts.iter().all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit())) {
        Some(candidate.to_string())
    } else {
        None
    }
}

/// The legacy-chain revision a database version maps to. A known version maps to its entry; an unknown but
/// well-formed version is treated as the latest (backwards compatible); a malformed version is incompatible.
pub fn legacy_revision_for(database_version: &str) -> Result<u32, String> {
    if let Some((revision, _)) = LEGACY_VAULT_VERSIONS.iter().find(|(_, version)| *version == database_version) {
        return Ok(*revision);
    }
    let well_formed = database_version.split('.').count() == 3 && database_version.split('.').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()));
    if well_formed {
        Ok(latest_legacy_revision())
    } else {
        Err(format!("Vault version {} is not compatible with this client", database_version))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_rules_match_the_client() {
        assert!(version_gte("0.12.0", "0.12.0-dev"));
        assert!(!version_gte("0.12.0-dev", "0.12.0"));
        assert!(version_gte("0.13.1", "0.12.0-dev"));
        assert!(!version_gte("0.11.9", "0.12.0-dev"));
        assert!(version_gte("1.0", "1.0.0"));
        assert!(version_gte("0.12.0-beta", "0.12.0-alpha"));
    }

    #[test]
    fn migration_ids_yield_their_version() {
        assert_eq!(extract_version_from_migration_id("20250101000000_2.0.0-Squashed").as_deref(), Some("2.0.0"));
        assert_eq!(extract_version_from_migration_id("20250101000000_Initial"), None);
        assert_eq!(legacy_revision_for("1.7.0"), Ok(12));
        assert_eq!(legacy_revision_for("2.0.0"), Ok(13));
        assert_eq!(legacy_revision_for("2.1.0"), Ok(13));
        assert!(legacy_revision_for("nope").is_err());
    }
}
