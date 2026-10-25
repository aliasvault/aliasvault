//! Public Suffix List lookup for registrable domain extraction.
//!
//! Rules are extracted from Mozilla's Public Suffix List (<https://publicsuffix.org>) and embedded via `include_str!`.
//! The list is refreshed by running `scripts/dependencies/refresh-external-dependencies.sh public-suffix-list`.

use std::collections::HashSet;
use std::sync::LazyLock;

/// The embedded rules-only list, `//` lines being comments.
static RULES_RAW: &str = include_str!("public_suffix_list.dat");

/// The parsed rules, split by kind so a lookup is a handful of set probes.
struct Rules {
    /// Plain rules as written (`co.uk`).
    plain: HashSet<&'static str>,
    /// Wildcard rules by the part after `*.` (`*.ck` is stored as `ck`).
    wildcard: HashSet<&'static str>,
    /// Exception rules without the `!` (`!www.ck` is stored as `www.ck`).
    exception: HashSet<&'static str>,
}

static RULES: LazyLock<Rules> = LazyLock::new(|| {
    let mut rules = Rules { plain: HashSet::new(), wildcard: HashSet::new(), exception: HashSet::new() };
    for line in RULES_RAW.lines() {
        let rule = line.split_whitespace().next().unwrap_or("");
        if rule.is_empty() || rule.starts_with("//") {
            continue;
        }
        if let Some(exception) = rule.strip_prefix('!') {
            rules.exception.insert(exception);
        } else if let Some(parent) = rule.strip_prefix("*.") {
            rules.wildcard.insert(parent);
        } else {
            rules.plain.insert(rule);
        }
    }
    rules
});

/// Byte offsets at which each label of `host` starts.
fn label_starts(host: &str) -> Vec<usize> {
    std::iter::once(0).chain(host.match_indices('.').map(|(i, _)| i + 1)).collect()
}

/// Number of trailing labels of `host` that form its public suffix.
fn public_suffix_label_count(host: &str, starts: &[usize]) -> usize {
    let rules = &*RULES;
    let label_count = starts.len();
    let mut best = 1;

    for labels in 1..=label_count {
        let tail = &host[starts[label_count - labels]..];
        if rules.exception.contains(tail) {
            // An exception rule prevails over everything and names a registrable domain: its parent is the suffix.
            return labels - 1;
        }
        if rules.plain.contains(tail) {
            best = labels;
        }
        if labels >= 2 && rules.wildcard.contains(&host[starts[label_count - labels + 1]..]) {
            best = labels;
        }
    }

    best
}

/// The registrable domain of `host`: its public suffix plus one label, kept as-is from the input.
pub fn registrable_domain(host: &str) -> Option<&str> {
    let host = host.strip_suffix('.').unwrap_or(host);
    if host.split('.').any(str::is_empty) {
        return None;
    }

    let lowered = host.to_ascii_lowercase();
    let starts = label_starts(&lowered);
    let suffix_labels = public_suffix_label_count(&lowered, &starts);
    let label_count = starts.len();
    if label_count <= suffix_labels {
        return None;
    }

    Some(&host[starts[label_count - suffix_labels - 1]..])
}

