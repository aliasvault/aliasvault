//! Version rules: which server versions this client supports.

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
}
