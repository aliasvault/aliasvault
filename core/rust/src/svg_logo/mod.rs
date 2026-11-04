//! Normalization of SVG logos for native (non-browser) renderers.
//!
//! Browsers apply a logo's CSS (`<style>`, `:root`, `@media`) and never load anything from an SVG shown as an image,
//! but the native renderers (react-native-svg, Macaw, AndroidSVG) each skip different parts of CSS and react-native-svg
//! fetches remote images. A logo is therefore rewritten into usvg's simplified SVG before a native renderer draws it:
//! paths, groups, gradients, clip paths and masks with resolved attributes, no CSS, no filters, only local references and
//! small embedded raster images. This only affects rendering, the stored bytes are not changed.

#[cfg(test)]
mod tests;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Largest SVG logo accepted, in bytes.
pub const MAX_SVG_LOGO_BYTES: usize = 256 * 1024;

/// Largest SVG after CSS variables are substituted, and largest normalized output, in bytes.
const MAX_EXPANDED_BYTES: usize = 1024 * 1024;

/// Largest width or height of an embedded raster image, in pixels.
const MAX_EMBEDDED_IMAGE_SIDE: usize = 1024;

/// Most pixels all embedded raster images of one logo may decode to together.
const MAX_EMBEDDED_IMAGE_PIXELS: u64 = 2 * 1024 * 1024;

/// Rewrite an SVG logo into simplified SVG every renderer draws the way a browser does, or None when it cannot be drawn.
///
/// `dark` picks the `@media (prefers-color-scheme: dark)` rules over the light ones, as a browser in dark mode would.
pub fn normalize_svg_logo(svg: &[u8], dark: bool) -> Option<Vec<u8>> {
    if svg.len() > MAX_SVG_LOGO_BYTES {
        return None;
    }
    let text = std::str::from_utf8(svg).ok()?;
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);

    let decoded_pixels = Arc::new(AtomicU64::new(0));
    let budget = Arc::clone(&decoded_pixels);
    let options = usvg::Options {
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_data: Box::new(move |_, data, _| resolve_embedded_raster(data, &budget)),
            resolve_string: Box::new(|_, _| None),
        },
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_str(&resolve_css_variables(&rewrite_style_sheets(text, dark))?, &options).ok()?;

    let size = tree.size();
    if size.width() <= 0.0 || size.height() <= 0.0 {
        return None;
    }

    let written = tree.to_string(&usvg::WriteOptions { indent: usvg::Indent::None, attributes_indent: usvg::Indent::None, ..usvg::WriteOptions::default() });

    // `<use>` copies its target, so a small input can still write a huge document.
    if written.len() > MAX_EXPANDED_BYTES {
        return None;
    }

    // usvg folds the viewBox into a transform and writes only width and height, while renderers scale by the viewBox.
    let body = strip_filters(written.strip_prefix("<svg")?);
    Some(format!("<svg viewBox=\"0 0 {} {}\"{body}", size.width(), size.height()).into_bytes())
}

/// Keep an embedded PNG, JPEG, GIF or WebP image within the pixel budget; anything else, such as an SVG inside the SVG, is dropped.
fn resolve_embedded_raster(data: Arc<Vec<u8>>, decoded_pixels: &AtomicU64) -> Option<usvg::ImageKind> {
    let size = imagesize::blob_size(&data).ok()?;
    if size.width == 0 || size.height == 0 || size.width > MAX_EMBEDDED_IMAGE_SIDE || size.height > MAX_EMBEDDED_IMAGE_SIDE {
        return None;
    }
    let pixels = (size.width * size.height) as u64;
    if decoded_pixels.fetch_add(pixels, Ordering::Relaxed) + pixels > MAX_EMBEDDED_IMAGE_PIXELS {
        return None;
    }
    match imagesize::image_type(&data).ok()? {
        imagesize::ImageType::Png => Some(usvg::ImageKind::PNG(data)),
        imagesize::ImageType::Jpeg => Some(usvg::ImageKind::JPEG(data)),
        imagesize::ImageType::Gif => Some(usvg::ImageKind::GIF(data)),
        imagesize::ImageType::Webp => Some(usvg::ImageKind::WEBP(data)),
        _ => None,
    }
}

/// Remove filters from usvg's output: the native renderers support them unevenly, and a filter region or effect can
/// make a renderer allocate or compute far beyond what a logo needs.
pub(super) fn strip_filters(svg: &str) -> String {
    let mut result = String::with_capacity(svg.len());
    let mut rest = svg;
    while let Some(start) = rest.find("<filter ") {
        result.push_str(&rest[..start]);
        let Some(end) = rest[start..].find("</filter>").map(|i| start + i + "</filter>".len()) else { return String::new() };
        rest = &rest[end..];
    }
    result.push_str(rest);

    let mut stripped = String::with_capacity(result.len());
    let mut rest = result.as_str();
    while let Some(start) = rest.find(" filter=\"") {
        stripped.push_str(&rest[..start]);
        let value = &rest[start + " filter=\"".len()..];
        let Some(end) = value.find('"') else { return String::new() };
        rest = &value[end + 1..];
    }
    stripped.push_str(rest);
    stripped
}

/// Rewrite the CSS of every `<style>` element into what usvg's CSS engine applies the way a browser would.
fn rewrite_style_sheets(svg: &str, dark: bool) -> String {
    // ASCII lowercasing keeps byte offsets, so positions found in `lower` index into `svg`.
    let lower = svg.to_ascii_lowercase();
    let mut result = String::with_capacity(svg.len());
    let mut position = 0;
    while let Some(found) = lower[position..].find("<style") {
        let Some(open_end) = lower[position + found..].find('>').map(|i| position + found + i + 1) else { break };
        let Some(close) = lower[open_end..].find("</style").map(|i| open_end + i) else { break };
        result.push_str(&svg[position..open_end]);
        result.push_str(&rewrite_css(&svg[open_end..close], dark));
        position = close;
    }
    result.push_str(&svg[position..]);
    result
}

/// Map `:root` to the root `svg` element, and apply the color scheme media block that matches `dark`.
pub(super) fn rewrite_css(css: &str, dark: bool) -> String {
    let flattened = apply_color_scheme(css, dark);
    let mut result = String::with_capacity(flattened.len());
    let mut rest = flattened.as_str();
    while let Some(index) = rest.find(":root") {
        let after = &rest[index + ":root".len()..];
        let continues_name = after.chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        result.push_str(&rest[..index]);
        if continues_name {
            result.push_str(":root");
        } else {
            // `:root` alone selects the root element; after a type selector (`svg:root`) it only narrows it.
            let starts_selector = result.chars().last().is_none_or(|c| c.is_whitespace() || matches!(c, ',' | '>' | '+' | '~' | '{' | '}' | '/' | '['));
            if starts_selector {
                result.push_str("svg");
            }
        }
        rest = after;
    }
    result.push_str(rest);
    result
}

/// Move the rules of the `@media (prefers-color-scheme: ...)` block matching `dark` to the end of the sheet, so they
/// override earlier rules, and drop the blocks for the other scheme.
fn apply_color_scheme(css: &str, dark: bool) -> String {
    let wanted = if dark { "dark" } else { "light" };
    let mut kept = String::with_capacity(css.len());
    let mut applied = String::new();
    let mut rest = css;
    while let Some(at) = rest.find("@media") {
        let Some(open) = rest[at..].find('{').map(|i| at + i) else { break };
        let prelude: String = rest[at + "@media".len()..open].chars().filter(|c| !c.is_whitespace()).collect::<String>().to_ascii_lowercase();
        let Some(scheme) = prelude.strip_prefix("(prefers-color-scheme:").and_then(|p| p.strip_suffix(')')) else {
            kept.push_str(&rest[..open + 1]);
            rest = &rest[open + 1..];
            continue;
        };
        let Some(close) = matching_brace(&rest[open..]).map(|i| open + i) else { break };
        kept.push_str(&rest[..at]);
        if scheme == wanted {
            applied.push_str(&rest[open + 1..close]);
        }
        rest = &rest[close + 1..];
    }
    kept.push_str(rest);
    kept.push_str(&applied);
    kept
}

/// Deepest chain of variables referring to variables that is resolved.
const MAX_VARIABLE_DEPTH: usize = 8;

/// Most `var()` references substituted in one logo, counting those inside substituted values.
const MAX_VARIABLE_SUBSTITUTIONS: usize = 10_000;

/// Replace every `var(--name)` and `var(--name, fallback)` with its value, since usvg's CSS engine has no custom properties.
pub(super) fn resolve_css_variables(svg: &str) -> Option<String> {
    if !svg.contains("var(") {
        return Some(svg.to_string());
    }
    let mut variables = std::collections::HashMap::new();
    let mut rest = svg;
    while let Some(index) = rest.find("--") {
        let after = &rest[index + 2..];
        let name_length = after.find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_')).unwrap_or(after.len());
        let value = after[name_length..].trim_start();
        if name_length > 0 {
            if let Some(value) = value.strip_prefix(':') {
                let end = value.find([';', '}', '"', '\'', '<']).unwrap_or(value.len());
                variables.insert(&after[..name_length], value[..end].trim());
            }
        }
        rest = &after[name_length..];
    }
    let mut result = String::with_capacity(svg.len());
    substitute_variables(svg, &variables, 0, &mut 0, &mut result)?;
    Some(result)
}

/// Append `text` to `result` with its `var()` references substituted.
fn substitute_variables(text: &str, variables: &std::collections::HashMap<&str, &str>, depth: usize, substitutions: &mut usize, result: &mut String) -> Option<()> {
    let mut rest = text;
    while let Some(index) = rest.find("var(") {
        let Some(close) = matching_parenthesis(&rest[index + 3..]).map(|i| index + 3 + i) else { break };
        let inner = &rest[index + 4..close];
        let (name, fallback) = split_top_level_comma(inner);
        let value = variables.get(name.trim().trim_start_matches("--")).copied().or(fallback.map(str::trim));
        result.push_str(&rest[..index]);
        *substitutions += 1;
        if *substitutions > MAX_VARIABLE_SUBSTITUTIONS {
            return None;
        }
        match value {
            Some(value) if depth < MAX_VARIABLE_DEPTH => substitute_variables(value, variables, depth + 1, substitutions, result)?,
            _ => result.push_str(&rest[index..=close]),
        }
        if result.len() > MAX_EXPANDED_BYTES {
            return None;
        }
        rest = &rest[close + 1..];
    }
    result.push_str(rest);
    (result.len() <= MAX_EXPANDED_BYTES).then_some(())
}

/// Split a `var()` argument list into the name and the fallback after the first comma outside parentheses.
fn split_top_level_comma(arguments: &str) -> (&str, Option<&str>) {
    let mut depth = 0usize;
    for (index, c) in arguments.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => return (&arguments[..index], Some(&arguments[index + 1..])),
            _ => {}
        }
    }
    (arguments, None)
}

/// The byte index of the `)` closing the `(` that `text` starts with.
fn matching_parenthesis(text: &str) -> Option<usize> {
    let mut depth = 0usize;
    for (index, c) in text.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

/// The byte index of the `}` closing the `{` that `block` starts with.
fn matching_brace(block: &str) -> Option<usize> {
    let mut depth = 0usize;
    for (index, c) in block.char_indices() {
        match c {
            '{' => depth += 1,
            '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}
