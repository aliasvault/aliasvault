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
    let resolve = |svg: &str| resolve_css_variables(svg).expect("within the caps");
    assert_eq!(resolve(r##"<path fill="var(--missing, #123456)"/>"##), r##"<path fill="#123456"/>"##);
    assert_eq!(resolve(r#"<path fill="var(--missing)"/>"#), r#"<path fill="var(--missing)"/>"#);
    assert_eq!(resolve("<style>:root{--a:var(--b);--b:#abcdef}</style><path fill=\"var(--a)\"/>"), "<style>:root{--a:#abcdef;--b:#abcdef}</style><path fill=\"#abcdef\"/>");
    assert_eq!(resolve("<style>:root{--a:var(--a)}</style><path fill=\"var(--a)\"/>").matches("var(--a)").count(), 2);
}

/// Variables that each repeat the previous one, so one reference expands to `fanout ^ levels` copies of `leaf`.
fn variable_bomb(leaf: &str, fanout: usize, levels: usize) -> String {
    let mut sheet = format!("--v0: {leaf};");
    for level in 1..=levels {
        sheet.push_str(&format!("--v{level}: {};", vec![format!("var(--v{})", level - 1); fanout].join(" ")));
    }
    format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><style>:root{{{sheet}}}</style><path fill="var(--v{levels})" d="M0 0h1v1H0z"/></svg>"#)
}

#[test]
fn exponential_variable_expansion_is_rejected() {
    assert!(normalize_svg_logo(variable_bomb("#000", 40, 7).as_bytes(), false).is_none());
    // Expanding to nothing never grows the output, so only the substitution count stops it.
    assert!(normalize_svg_logo(variable_bomb("", 40, 7).as_bytes(), false).is_none());
}

/// A 1-bit grayscale PNG of `side` x `side` pixels, all black, as base64.
fn blank_png(side: u32) -> String {
    use base64::Engine;
    use std::io::Write;
    fn chunk(kind: &[u8], data: &[u8]) -> Vec<u8> {
        let mut crc = flate2::Crc::new();
        crc.update(kind);
        crc.update(data);
        [&(data.len() as u32).to_be_bytes()[..], kind, data, &crc.sum().to_be_bytes()].concat()
    }
    let row = vec![0u8; 1 + (side as usize).div_ceil(8)];
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::best());
    for _ in 0..side {
        encoder.write_all(&row).unwrap();
    }
    let header = [&side.to_be_bytes()[..], &side.to_be_bytes()[..], &[1, 0, 0, 0, 0]].concat();
    let png = [&b"\x89PNG\r\n\x1a\n"[..], &chunk(b"IHDR", &header), &chunk(b"IDAT", &encoder.finish().unwrap()), &chunk(b"IEND", &[])].concat();
    base64::engine::general_purpose::STANDARD.encode(png)
}

fn svg_with_images(png: &str, count: usize) -> String {
    let images: String = (0..count).map(|_| format!(r#"<image width="1" height="1" href="data:image/png;base64,{png}"/>"#)).collect();
    format!(r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">{images}<rect width="1" height="1" fill="#ff0000"/></svg>"##)
}

#[test]
fn oversized_embedded_images_are_dropped() {
    // About 100 KB of PNG that a decoder would expand to 900 million pixels.
    let out = normalize(&svg_with_images(&blank_png(30_000), 1), false);
    assert!(!out.contains("<image"), "{}", &out[..out.len().min(300)]);
    assert!(out.contains("fill=\"#ff0000\""));

    assert!(normalize(&svg_with_images(&blank_png(64), 1), false).contains("<image"));
}

#[test]
fn embedded_images_share_one_pixel_budget() {
    // Each 1024 x 1024 image fits on its own; the third goes past the budget for the logo.
    let out = normalize(&svg_with_images(&blank_png(1024), 3), false);
    assert_eq!(out.matches("<image").count(), 2);
}

#[test]
fn embedded_image_format_is_read_from_the_bytes() {
    let fake = format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image width="1" height="1" href="data:image/png;base64,{}"/></svg>"#, "PHN2Zy8+");
    assert!(!normalize(&fake, false).contains("<image"));
}

#[test]
fn filters_are_removed() {
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><filter id="f" x="-1000000" width="3000000"><feGaussianBlur stdDeviation="100000"/><feTurbulence baseFrequency="0.9" numOctaves="1000000"/></filter><rect width="100000" height="100000" fill="#00ff00" filter="url(#f)"/></svg>"##;
    let out = normalize(svg, false);
    assert!(!out.contains("filter") && !out.contains("feTurbulence") && !out.contains("feGaussianBlur"), "{out}");
    assert!(out.contains("fill=\"#00ff00\""), "{out}");
}

#[test]
fn use_amplification_is_rejected() {
    let mut defs = String::from(r#"<path id="u0" d="M0 0h1v1H0z"/>"#);
    for level in 1..=4 {
        defs.push_str(&format!(r#"<g id="u{level}">{}</g>"#, format!(r##"<use href="#u{}"/>"##, level - 1).repeat(30)));
    }
    let svg = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><defs>{defs}</defs><use href="#u4"/></svg>"##);
    assert!(normalize_svg_logo(svg.as_bytes(), false).is_none());
}

#[test]
fn entity_and_nesting_attacks_are_rejected() {
    let entities: String = (1..10).map(|i| format!(r#"<!ENTITY l{i} "{}">"#, format!("&l{};", i - 1).repeat(10))).collect();
    let laughs = format!(r#"<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY l0 "lol">{entities}]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>&l9;</title></svg>"#);
    assert!(normalize_svg_logo(laughs.as_bytes(), false).is_none());

    let external = r#"<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><title>&x;</title></svg>"#;
    assert!(normalize_svg_logo(external.as_bytes(), false).is_none());

    let nested = format!(r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">{}<rect width="1" height="1"/>{}</svg>"#, "<g>".repeat(20_000), "</g>".repeat(20_000));
    assert!(normalize_svg_logo(nested.as_bytes(), false).is_none());

    let recursive = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></svg>"##;
    assert!(normalize_svg_logo(recursive.as_bytes(), false).map_or(true, |out| !String::from_utf8(out).unwrap().contains("<use")));
}

#[test]
fn script_and_link_vectors_are_removed() {
    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><a xlink:href="javascript:alert(1)"><rect width="5" height="5" onclick="alert(1)"/></a><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="onmouseover" to="alert(1)"/><rect x="5" width="5" height="5" style="fill:url(javascript:alert(1))"/></svg>"#;
    let out = normalize(svg, false);
    for banned in ["javascript", "onclick", "onmouseover", "<a", "<animate", "<set"] {
        assert!(!out.contains(banned), "{banned} in {out}");
    }
}
