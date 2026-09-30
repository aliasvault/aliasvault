//! Public Suffix List lookup for registrable domain extraction.
//!
//! Rules are extracted from Mozilla's Public Suffix List (<https://publicsuffix.org>) and embedded via `include_str!`.
//! The list is refreshed by running `scripts/refresh-external-dependencies.sh public-suffix-list`.

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
    if host.is_empty() {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_is_loaded_with_both_sections() {
        assert!(RULES.plain.len() > 5000, "expected the full list, got {} plain rules", RULES.plain.len());
        assert!(RULES.plain.contains("nl"), "ICANN section missing");
        assert!(RULES.plain.contains("co.uk"), "ICANN section missing");
        assert!(RULES.plain.contains("github.io"), "PRIVATE section missing");
        assert!(RULES.wildcard.contains("sch.uk"));
        assert!(RULES.exception.contains("www.ck"));
    }

    #[test]
    fn plain_rules() {
        assert_eq!(registrable_domain("example.com"), Some("example.com"));
        assert_eq!(registrable_domain("mijn.overheid.nl"), Some("overheid.nl"));
        assert_eq!(registrable_domain("login.bank.co.nl"), Some("bank.co.nl"));
        assert_eq!(registrable_domain("docs.example.co.uk"), Some("example.co.uk"));
        assert_eq!(registrable_domain("a.b.example.org.uk"), Some("example.org.uk"));
        // Rules with more labels win over shorter ones: "site.hosting-cluster.nl" is listed next to "hosting-cluster.nl".
        assert_eq!(registrable_domain("shop.hosting-cluster.nl"), Some("shop.hosting-cluster.nl"));
        assert_eq!(registrable_domain("www.shop.site.hosting-cluster.nl"), Some("shop.site.hosting-cluster.nl"));
    }

    #[test]
    fn public_suffix_itself_has_no_registrable_domain() {
        assert_eq!(registrable_domain("com"), None);
        assert_eq!(registrable_domain("nl"), None);
        assert_eq!(registrable_domain("co.uk"), None);
        assert_eq!(registrable_domain("gov.nl"), None);
        assert_eq!(registrable_domain("github.io"), None);
        assert_eq!(registrable_domain("localhost"), None);
        assert_eq!(registrable_domain(""), None);
    }

    #[test]
    fn private_section_splits_tenants() {
        assert_eq!(registrable_domain("myproject.vercel.app"), Some("myproject.vercel.app"));
        assert_eq!(registrable_domain("evil-phish.vercel.app"), Some("evil-phish.vercel.app"));
        assert_eq!(registrable_domain("preview.myproject.vercel.app"), Some("myproject.vercel.app"));
        assert_eq!(registrable_domain("user.github.io"), Some("user.github.io"));
        assert_eq!(registrable_domain("group.gitlab.io"), Some("group.gitlab.io"));
        assert_eq!(registrable_domain("site.pages.dev"), Some("site.pages.dev"));
        assert_eq!(registrable_domain("app.netlify.app"), Some("app.netlify.app"));
        assert_eq!(registrable_domain("api.herokuapp.com"), Some("api.herokuapp.com"));
        assert_eq!(registrable_domain("webshop.azurewebsites.net"), Some("webshop.azurewebsites.net"));
        assert_eq!(registrable_domain("myapp.readthedocs.io"), Some("myapp.readthedocs.io"));
        assert_eq!(registrable_domain("tax.service.gov.uk"), Some("tax.service.gov.uk"));
    }

    #[test]
    fn wildcard_rules() {
        // "*.sch.uk" makes every school district under sch.uk a public suffix.
        assert_eq!(registrable_domain("district.sch.uk"), None);
        assert_eq!(registrable_domain("myschool.district.sch.uk"), Some("myschool.district.sch.uk"));
        assert_eq!(registrable_domain("www.myschool.district.sch.uk"), Some("myschool.district.sch.uk"));
        // "*.elb.amazonaws.com" in the PRIVATE section: each load balancer is its own registrable domain.
        assert_eq!(registrable_domain("my-lb-123.eu-west-1.elb.amazonaws.com"), Some("my-lb-123.eu-west-1.elb.amazonaws.com"));
    }

    #[test]
    fn exception_rules() {
        // The list only has exception rules under .ck and a few Japanese cities: "*.ck" with "!www.ck".
        assert_eq!(registrable_domain("foo.ck"), None);
        assert_eq!(registrable_domain("bar.foo.ck"), Some("bar.foo.ck"));
        assert_eq!(registrable_domain("www.ck"), Some("www.ck"));
        assert_eq!(registrable_domain("sub.www.ck"), Some("www.ck"));
    }

    #[test]
    fn unlisted_suffix_falls_back_to_last_label() {
        assert_eq!(registrable_domain("nas.home.lan"), Some("home.lan"));
        assert_eq!(registrable_domain("myserver.local"), Some("myserver.local"));
        assert_eq!(registrable_domain("plex.myserver.local"), Some("myserver.local"));
        assert_eq!(registrable_domain("app.localhost"), Some("app.localhost"));
    }

    #[test]
    fn lookup_is_case_insensitive_and_keeps_input_casing() {
        assert_eq!(registrable_domain("Login.Example.CO.UK"), Some("Example.CO.UK"));
        assert_eq!(registrable_domain("My.Overheid.NL"), Some("Overheid.NL"));
    }
}
