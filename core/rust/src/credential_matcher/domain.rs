//! Domain extraction and matching utilities.

use std::collections::HashSet;

/// Common top-level domains (TLDs) used for app package name detection.
/// When a search string starts with one of these TLDs followed by a dot (e.g., "com.coolblue.app"),
/// it's identified as a reversed domain name (app package name) rather than a regular URL.
static COMMON_TLDS: &[&str] = &[
    // Generic TLDs
    "com", "net", "org", "edu", "gov", "mil", "int",
    // Country code TLDs
    "nl", "de", "uk", "fr", "it", "es", "pl", "be", "ch", "at", "se", "no", "dk", "fi",
    "pt", "gr", "cz", "hu", "ro", "bg", "hr", "sk", "si", "lt", "lv", "ee", "ie", "lu",
    "us", "ca", "mx", "br", "ar", "cl", "co", "ve", "pe", "ec",
    "au", "nz", "jp", "cn", "in", "kr", "tw", "hk", "sg", "my", "th", "id", "ph", "vn",
    "za", "eg", "ng", "ke", "ug", "tz", "ma",
    "ru", "ua", "by", "kz", "il", "tr", "sa", "ae", "qa", "kw",
    // New gTLDs (common ones)
    "app", "dev", "io", "ai", "tech", "shop", "store", "online", "site", "website",
    "blog", "news", "media", "tv", "video", "music", "pro", "info", "biz", "name",
];

/// Common two-level public TLDs for root domain extraction.
static TWO_LEVEL_TLDS: &[&str] = &[
    // Australia
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
    // United Kingdom
    "co.uk", "org.uk", "net.uk", "ac.uk", "gov.uk", "plc.uk", "ltd.uk", "me.uk",
    // Canada
    "co.ca", "net.ca", "org.ca", "gc.ca", "ab.ca", "bc.ca", "mb.ca", "nb.ca", "nf.ca", "nl.ca", "ns.ca", "nt.ca", "nu.ca",
    "on.ca", "pe.ca", "qc.ca", "sk.ca", "yk.ca",
    // India
    "co.in", "net.in", "org.in", "edu.in", "gov.in", "ac.in", "res.in", "gen.in", "firm.in", "ind.in",
    // Japan
    "co.jp", "ne.jp", "or.jp", "ac.jp", "ad.jp", "ed.jp", "go.jp", "gr.jp", "lg.jp",
    // South Africa
    "co.za", "net.za", "org.za", "edu.za", "gov.za", "ac.za", "web.za",
    // New Zealand
    "co.nz", "net.nz", "org.nz", "edu.nz", "govt.nz", "ac.nz", "geek.nz", "gen.nz", "kiwi.nz", "maori.nz", "mil.nz", "school.nz",
    // Brazil
    "com.br", "net.br", "org.br", "edu.br", "gov.br", "mil.br", "art.br", "etc.br", "adv.br", "arq.br", "bio.br", "cim.br",
    "cng.br", "cnt.br", "ecn.br", "eng.br", "esp.br", "eti.br", "far.br", "fnd.br", "fot.br", "fst.br", "g12.br", "geo.br",
    "ggf.br", "jor.br", "lel.br", "mat.br", "med.br", "mus.br", "not.br", "ntr.br", "odo.br", "ppg.br", "pro.br", "psc.br",
    "psi.br", "qsl.br", "rec.br", "slg.br", "srv.br", "tmp.br", "trd.br", "tur.br", "tv.br", "vet.br", "zlg.br",
    // Russia
    "com.ru", "net.ru", "org.ru", "edu.ru", "gov.ru", "int.ru", "mil.ru", "spb.ru", "msk.ru",
    // China
    "com.cn", "net.cn", "org.cn", "edu.cn", "gov.cn", "mil.cn", "ac.cn", "ah.cn", "bj.cn", "cq.cn", "fj.cn", "gd.cn", "gs.cn",
    "gz.cn", "gx.cn", "ha.cn", "hb.cn", "he.cn", "hi.cn", "hk.cn", "hl.cn", "hn.cn", "jl.cn", "js.cn", "jx.cn", "ln.cn", "mo.cn",
    "nm.cn", "nx.cn", "qh.cn", "sc.cn", "sd.cn", "sh.cn", "sn.cn", "sx.cn", "tj.cn", "tw.cn", "xj.cn", "xz.cn", "yn.cn", "zj.cn",
    // Mexico
    "com.mx", "net.mx", "org.mx", "edu.mx", "gob.mx",
    // Argentina
    "com.ar", "net.ar", "org.ar", "edu.ar", "gov.ar", "mil.ar", "int.ar",
    // Chile
    "com.cl", "net.cl", "org.cl", "edu.cl", "gov.cl", "mil.cl",
    // Colombia
    "com.co", "net.co", "org.co", "edu.co", "gov.co", "mil.co", "nom.co",
    // Venezuela
    "com.ve", "net.ve", "org.ve", "edu.ve", "gov.ve", "mil.ve", "web.ve",
    // Peru
    "com.pe", "net.pe", "org.pe", "edu.pe", "gob.pe", "mil.pe", "nom.pe",
    // Ecuador
    "com.ec", "net.ec", "org.ec", "edu.ec", "gov.ec", "mil.ec", "med.ec", "fin.ec", "pro.ec", "info.ec",
    // Europe
    "co.at", "or.at", "ac.at", "gv.at", "priv.at",
    "co.be", "ac.be",
    "co.dk", "ac.dk",
    "co.il", "net.il", "org.il", "ac.il", "gov.il", "idf.il", "k12.il", "muni.il",
    "co.no", "ac.no", "priv.no",
    "co.pl", "net.pl", "org.pl", "edu.pl", "gov.pl", "mil.pl", "nom.pl", "com.pl",
    "co.th", "net.th", "org.th", "edu.th", "gov.th", "mil.th", "ac.th", "in.th",
    "co.kr", "net.kr", "org.kr", "edu.kr", "gov.kr", "mil.kr", "ac.kr", "go.kr", "ne.kr", "or.kr", "pe.kr", "re.kr", "seoul.kr",
    "kyonggi.kr",
    // Others
    "co.id", "net.id", "org.id", "edu.id", "gov.id", "mil.id", "web.id", "ac.id", "sch.id",
    "co.ma", "net.ma", "org.ma", "edu.ma", "gov.ma", "ac.ma", "press.ma",
    "co.ke", "net.ke", "org.ke", "edu.ke", "gov.ke", "ac.ke", "go.ke", "info.ke", "me.ke", "mobi.ke", "sc.ke",
    "co.ug", "net.ug", "org.ug", "edu.ug", "gov.ug", "ac.ug", "sc.ug", "go.ug", "ne.ug", "or.ug",
    "co.tz", "net.tz", "org.tz", "edu.tz", "gov.tz", "ac.tz", "go.tz", "hotel.tz", "info.tz", "me.tz", "mil.tz", "mobi.tz",
    "ne.tz", "or.tz", "sc.tz", "tv.tz",
];

/// Check if a string is likely an app package name (reversed domain).
/// Package names start with TLD followed by dot (e.g., "com.example", "nl.app").
pub fn is_app_package_name(text: &str) -> bool {
    // Must contain a dot
    if !text.contains('.') {
        return false;
    }

    // Must not have protocol
    if text.starts_with("http://") || text.starts_with("https://") {
        return false;
    }

    // Extract first part before first dot
    let first_part = text.split('.').next().unwrap_or("").to_lowercase();

    // Check if first part is a common TLD - indicates reversed domain (package name)
    let tld_set: HashSet<&str> = COMMON_TLDS.iter().copied().collect();
    tld_set.contains(first_part.as_str())
}

/// Extract domain from URL, handling both full URLs and partial domains.
/// Returns empty string if not a valid URL/domain.
pub fn extract_domain(url: &str) -> String {
    if url.is_empty() {
        return String::new();
    }

    let mut domain = url.to_lowercase();

    // Check if it has a protocol
    let has_protocol = domain.starts_with("http://") || domain.starts_with("https://");

    // If no protocol and starts with TLD + dot, it's likely an app package name
    if !has_protocol && is_app_package_name(&domain) {
        return String::new();
    }

    // Remove protocol if present
    if let Some(stripped) = domain.strip_prefix("https://") {
        domain = stripped.to_string();
    } else if let Some(stripped) = domain.strip_prefix("http://") {
        domain = stripped.to_string();
    }

    // Remove www. prefix
    if let Some(stripped) = domain.strip_prefix("www.") {
        domain = stripped.to_string();
    }

    // Remove path, query, and fragment
    if let Some(pos) = domain.find('/') {
        domain = domain[..pos].to_string();
    }
    if let Some(pos) = domain.find('?') {
        domain = domain[..pos].to_string();
    }
    if let Some(pos) = domain.find('#') {
        domain = domain[..pos].to_string();
    }

    // Basic domain validation - must contain at least one dot and valid characters
    if !domain.contains('.') {
        return String::new();
    }

    // Check for valid domain characters
    if !domain.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return String::new();
    }

    // Ensure valid domain structure
    if domain.starts_with('.') || domain.ends_with('.') || domain.contains("..") {
        return String::new();
    }

    domain
}

/// Extract root domain from a domain string.
/// E.g., "sub.example.com" -> "example.com"
/// E.g., "sub.example.com.au" -> "example.com.au"
/// E.g., "sub.example.co.uk" -> "example.co.uk"
pub fn extract_root_domain(domain: &str) -> String {
    let parts: Vec<&str> = domain.split('.').collect();
    if parts.len() < 2 {
        return domain.to_string();
    }

    let two_level_set: HashSet<&str> = TWO_LEVEL_TLDS.iter().copied().collect();

    // Check if the last two parts form a known two-level TLD
    if parts.len() >= 3 {
        let last_two_parts = format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1]);
        if two_level_set.contains(last_two_parts.as_str()) {
            // Take the last three parts for two-level TLDs
            return parts[parts.len() - 3..].join(".");
        }
    }

    // Default to last two parts for regular TLDs
    if parts.len() >= 2 {
        parts[parts.len() - 2..].join(".")
    } else {
        domain.to_string()
    }
}

/// Check if two domains match, supporting subdomain matching.
/// Note: Both parameters should be pre-extracted domains (without protocol, www, path, etc.)
pub fn domains_match(domain1: &str, domain2: &str) -> bool {
    if domain1.is_empty() || domain2.is_empty() {
        return false;
    }

    // Exact match
    if domain1 == domain2 {
        return true;
    }

    // Check subdomain relationship (must end with ".domain" not just contain it)
    // e.g., "sub.example.com" is a subdomain of "example.com"
    // but "another-example.com" is NOT related to "example.com"
    if is_subdomain_of(domain1, domain2) || is_subdomain_of(domain2, domain1) {
        return true;
    }

    // Check root domain match
    let d1_root = extract_root_domain(domain1);
    let d2_root = extract_root_domain(domain2);

    d1_root == d2_root
}

/// Check if domain1 is a subdomain of domain2.
/// e.g., "sub.example.com" is a subdomain of "example.com"
/// but "another-example.com" is NOT a subdomain of "example.com"
fn is_subdomain_of(domain1: &str, domain2: &str) -> bool {
    // domain1 must be longer and end with ".domain2"
    if domain1.len() <= domain2.len() {
        return false;
    }

    // Check if domain1 ends with ".domain2" (proper subdomain boundary)
    domain1.ends_with(&format!(".{}", domain2))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_app_package_name() {
        assert!(is_app_package_name("com.coolblue.app"));
        assert!(is_app_package_name("nl.marktplaats.android"));
        assert!(is_app_package_name("org.example.app"));

        assert!(!is_app_package_name("https://example.com"));
        assert!(!is_app_package_name("example.com"));
        assert!(!is_app_package_name("coolblue.nl"));
        assert!(!is_app_package_name("nodot"));
    }

    #[test]
    fn test_extract_domain() {
        assert_eq!(extract_domain("https://www.example.com/path"), "example.com");
        assert_eq!(extract_domain("http://example.com"), "example.com");
        assert_eq!(extract_domain("example.com"), "example.com");
        assert_eq!(extract_domain("www.example.com"), "example.com");
        assert_eq!(extract_domain("https://example.com?query=1"), "example.com");
        assert_eq!(extract_domain("https://example.com#fragment"), "example.com");

        // Package names should return empty
        assert_eq!(extract_domain("com.coolblue.app"), "");

        // Invalid domains
        assert_eq!(extract_domain(""), "");
        assert_eq!(extract_domain("nodot"), "");
    }

    #[test]
    fn test_extract_root_domain() {
        assert_eq!(extract_root_domain("sub.example.com"), "example.com");
        assert_eq!(extract_root_domain("example.com"), "example.com");
        assert_eq!(extract_root_domain("sub.example.co.uk"), "example.co.uk");
        assert_eq!(extract_root_domain("example.co.uk"), "example.co.uk");
        assert_eq!(extract_root_domain("sub.example.com.au"), "example.com.au");
    }

    #[test]
    fn test_domains_match() {
        // Exact match
        assert!(domains_match("example.com", "example.com"));

        // Subdomain match
        assert!(domains_match("sub.example.com", "example.com"));
        assert!(domains_match("example.com", "sub.example.com"));

        // Root domain match
        assert!(domains_match("app.example.com", "www.example.com"));

        // No match
        assert!(!domains_match("example.com", "different.com"));
        assert!(!domains_match("coolblue.nl", "coolblue.be"));

        // CRITICAL: Substring match should NOT work (anti-phishing protection)
        // "another-example.com" contains "example.com" but is NOT a subdomain
        assert!(!domains_match("another-example.com", "example.com"));
        assert!(!domains_match("example.com", "another-example.com"));
        assert!(!domains_match("myexample.com", "example.com"));
        assert!(!domains_match("example.com.evil.com", "example.com"));
    }
}
