use crate::svg_logo::*;

fn normalize(svg: &str, dark: bool) -> String {
    String::from_utf8(normalize_svg_logo(svg.as_bytes(), dark).expect("logo normalizes")).unwrap()
}

/// A logo that colors itself with classes and switches color in dark mode.
const CLASS_STYLED: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 4 4">
  <defs><style>
    .brand-stop { stop-color: #2185d0; }
    .brand-fill { fill: #2185d0; }
    @media (prefers-color-scheme: dark) {
      .brand-stop { stop-color: #ffffff; }
      .brand-fill { fill: #ffffff; }
    }
  </style>
  <linearGradient id="A"><stop offset="0" class="brand-stop"/><stop offset="1" class="brand-stop" stop-opacity=".3"/></linearGradient></defs>
  <rect width="4" height="2" fill="url(#A)"/>
  <path d="M0 2h4v2H0z" class="brand-fill"/>
</svg>"#;

/// A logo with no fill on the root that turns the fill on through `:root` CSS.
const ROOT_STYLED: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180" fill="none">
  <style>
    :root { fill: #000; }
    @media (prefers-color-scheme: dark) { :root { fill: #fff; } }
  </style>
  <path d="M10 10h160v160H10z"/>
</svg>"#;

#[test]
fn class_rules_become_attributes() {
    let light = normalize(CLASS_STYLED, false);
    assert!(light.contains("fill=\"#2185d0\""), "{light}");
    assert!(light.contains("stop-color=\"#2185d0\""), "{light}");
    assert!(!light.contains("<style") && !light.contains("class="), "{light}");
}

#[test]
fn dark_mode_applies_the_dark_media_block() {
    let dark = normalize(CLASS_STYLED, true);
    assert!(dark.contains("fill=\"#ffffff\""), "{dark}");
    assert!(dark.contains("stop-color=\"#ffffff\""), "{dark}");
    assert!(!dark.contains("#2185d0"), "{dark}");
}

#[test]
fn root_rule_overrides_the_root_fill_attribute() {
    assert!(normalize(ROOT_STYLED, false).contains("fill=\"#000000\""));
    assert!(normalize(ROOT_STYLED, true).contains("fill=\"#ffffff\""));
}

#[test]
fn light_media_block_applies_only_in_light_mode() {
    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><style>path { fill: #111111 } @media (prefers-color-scheme: light) { path { fill: #222222 } }</style><path d="M0 0h2v2H0z"/></svg>"#;
    assert!(normalize(svg, false).contains("fill=\"#222222\""));
    assert!(normalize(svg, true).contains("fill=\"#111111\""));
}

#[test]
fn output_keeps_a_view_box_for_scaling() {
    let out = normalize(CLASS_STYLED, false);
    assert!(out.starts_with("<svg viewBox=\"0 0 16 16\""), "{out}");
}

#[test]
fn external_references_are_dropped() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
      <style>@import url(https://tracker.test/a.css); .k { fill: url(https://tracker.test/p.svg#x) }</style>
      <script>alert(1)</script>
      <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
      <image href="https://tracker.test/pixel.png" width="10" height="10"/>
      <image xlink:href="file:///etc/passwd" width="10" height="10"/>
      <use xlink:href="https://tracker.test/s.svg#a"/>
      <rect class="k" width="5" height="5"/>
      <rect x="5" width="5" height="5" fill="#00ff00"/>
    </svg>"##;
    let out = normalize(svg, false);
    for banned in ["tracker.test", "file:", "script", "foreignObject", "onload", "<image"] {
        assert!(!out.contains(banned), "{banned} in {out}");
    }
    assert!(out.contains("fill=\"#00ff00\""), "{out}");
}

#[test]
fn embedded_raster_images_are_kept_and_embedded_svg_is_dropped() {
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    let svg = format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><image href="data:image/png;base64,{png}" width="1" height="1"/><image x="1" href="data:image/svg+xml;base64,PHN2Zy8+" width="1" height="1"/></svg>"#);
    let out = normalize(&svg, false);
    assert!(out.contains("data:image/png;base64,"), "{out}");
    assert!(!out.contains("image/svg+xml"), "{out}");
}

#[test]
fn unusable_input_is_rejected() {
    assert!(normalize_svg_logo(b"", false).is_none());
    assert!(normalize_svg_logo(b"not an svg", false).is_none());
    assert!(normalize_svg_logo(&[0xFF, 0xFE, 0x00], false).is_none());
    assert!(normalize_svg_logo(br#"<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"/>"#, false).is_none());

    let oversized = format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><!--{}--></svg>"#, "x".repeat(MAX_SVG_LOGO_BYTES));
    assert!(normalize_svg_logo(oversized.as_bytes(), false).is_none());
}

#[test]
fn byte_order_mark_is_accepted() {
    let svg = format!("\u{FEFF}{ROOT_STYLED}");
    assert!(normalize_svg_logo(svg.as_bytes(), false).is_some());
}

#[test]
fn root_selector_maps_to_the_svg_element() {
    assert_eq!(rewrite_css(":root{fill:#000}", false), "svg{fill:#000}");
    assert_eq!(rewrite_css("svg:root{fill:#000}", false), "svg{fill:#000}");
    assert_eq!(rewrite_css(":root path, :root > g{fill:#000}", false), "svg path, svg > g{fill:#000}");
    assert_eq!(rewrite_css(":rooted{fill:#000}", false), ":rooted{fill:#000}");
}

#[test]
fn other_media_blocks_are_left_to_the_css_engine() {
    assert_eq!(rewrite_css("@media print{a{b:c}} d{e:f}", false), "@media print{a{b:c}} d{e:f}");
}

/// A logo that colors itself with custom properties defined on `:root`, swapped in dark mode.
const VARIABLE_STYLED: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" fill="none">
  <style>
    :root { --primary-fill: #fff; --secondary-fill: #000; }
    @media (prefers-color-scheme: dark) { :root { --primary-fill: #000; --secondary-fill: #fff; } }
  </style>
  <rect width="180" height="180" fill="var(--primary-fill)" rx="90"/>
  <path fill="var(--secondary-fill)" d="M60 60h60v60H60z"/>
</svg>"#;

#[test]
fn custom_properties_resolve_per_color_scheme() {
    let light = normalize(VARIABLE_STYLED, false);
    let dark = normalize(VARIABLE_STYLED, true);
    let fills = |svg: &str| svg.match_indices("fill=\"#").map(|(i, _)| svg[i + 6..i + 13].to_string()).collect::<Vec<_>>();
    assert_eq!(fills(&light), ["#ffffff", "#000000"], "{light}");
    assert_eq!(fills(&dark), ["#000000", "#ffffff"], "{dark}");
}

#[test]
fn custom_property_fallbacks_and_unknown_names() {
    assert_eq!(resolve_css_variables(r##"<path fill="var(--missing, #123456)"/>"##), r##"<path fill="#123456"/>"##);
    assert_eq!(resolve_css_variables(r#"<path fill="var(--missing)"/>"#), r#"<path fill="var(--missing)"/>"#);
    assert_eq!(resolve_css_variables("<style>:root{--a:var(--b);--b:#abcdef}</style><path fill=\"var(--a)\"/>"), "<style>:root{--a:#abcdef;--b:#abcdef}</style><path fill=\"#abcdef\"/>");
    assert_eq!(resolve_css_variables("<style>:root{--a:var(--a)}</style><path fill=\"var(--a)\"/>").matches("var(--a)").count(), 2);
}
