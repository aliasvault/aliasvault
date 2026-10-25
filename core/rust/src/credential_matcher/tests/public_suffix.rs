use crate::credential_matcher::public_suffix::*;

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
fn trailing_dot_and_empty_labels() {
    // A fully qualified host has the same registrable domain as without its trailing dot, never the bare TLD.
    assert_eq!(registrable_domain("bank.com."), Some("bank.com"));
    assert_eq!(registrable_domain("login.bank.com."), Some("bank.com"));
    assert_eq!(registrable_domain("victim.vercel.app."), Some("victim.vercel.app"));
    assert_eq!(registrable_domain("com."), None);
    assert_eq!(registrable_domain("vercel.app."), None);

    // Empty labels make a host malformed: no registrable domain at all.
    assert_eq!(registrable_domain(".com"), None);
    assert_eq!(registrable_domain("a..b.com"), None);
    assert_eq!(registrable_domain("bank.com.."), None);
    assert_eq!(registrable_domain(".."), None);
    assert_eq!(registrable_domain("."), None);
}

#[test]
fn lookup_is_case_insensitive_and_keeps_input_casing() {
    assert_eq!(registrable_domain("Login.Example.CO.UK"), Some("Example.CO.UK"));
    assert_eq!(registrable_domain("My.Overheid.NL"), Some("Overheid.NL"));
}
