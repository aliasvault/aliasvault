/**
 * Reads the icon SVG sources in core/assets/icons and serializes them back to SVG markup.
 */

const fs = require('fs');
const path = require('path');

/** The child elements an icon may contain. */
const SHAPE_TAGS = ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'];

/** Root attributes that only matter when viewing the file on its own; generated output drops them. */
const DROPPED_ROOT_ATTRS = ['xmlns', 'width', 'height', 'class', 'aria-hidden', 'data-slot'];

/**
 * Parse `name="value"` pairs, keeping their order.
 */
function parseAttributes(source, file) {
  const attrs = {};
  const rest = source.replace(/([\w:-]+)="([^"]*)"/g, (_, name, value) => {
    attrs[name] = value;
    return '';
  });
  if (rest.trim() !== '') {
    throw new Error(`${file}: unsupported attribute syntax "${rest.trim()}"`);
  }
  return attrs;
}

/**
 * Parse one icon file into its root attributes and shape nodes.
 */
function parseIconSvg(text, file) {
  const source = text.replace(/<!--[\s\S]*?-->/g, '').trim();
  const rootMatch = source.match(/^<svg\b([^>]*)>([\s\S]*)<\/svg>$/);
  if (!rootMatch) {
    throw new Error(`${file}: expected a single <svg> root element`);
  }

  const rootAttrs = parseAttributes(rootMatch[1], file);
  for (const name of DROPPED_ROOT_ATTRS) {
    delete rootAttrs[name];
  }
  if (!rootAttrs.viewBox) {
    throw new Error(`${file}: the <svg> root needs a viewBox`);
  }

  const nodes = [];
  const body = rootMatch[2].replace(/<(\w+)\b([^>]*?)\s*\/>|<(\w+)\b([^>]*?)>\s*<\/\3>/g, (_, tagA, attrsA, tagB, attrsB) => {
    const tag = tagA || tagB;
    if (!SHAPE_TAGS.includes(tag)) {
      throw new Error(`${file}: <${tag}> is not supported, use only ${SHAPE_TAGS.join(', ')}`);
    }
    nodes.push([tag, parseAttributes(attrsA ?? attrsB ?? '', file)]);
    return '';
  });
  if (body.trim() !== '') {
    throw new Error(`${file}: unsupported content "${body.trim().slice(0, 60)}"`);
  }
  if (nodes.length === 0) {
    throw new Error(`${file}: the icon has no shapes`);
  }

  return { attrs: rootAttrs, nodes };
}

/**
 * Read every `<name>.svg` in a folder, sorted by name.
 */
function readIconFolder(folder) {
  const icons = {};
  for (const file of fs.readdirSync(folder).filter((f) => f.endsWith('.svg')).sort()) {
    icons[path.basename(file, '.svg')] = parseIconSvg(fs.readFileSync(path.join(folder, file), 'utf8'), path.join(folder, file));
  }
  return icons;
}

/**
 * Serialize attributes as ` name="value"` pairs.
 */
function attributeString(attrs) {
  return Object.entries(attrs).map(([name, value]) => ` ${name}="${value}"`).join('');
}

/**
 * Serialize an icon back to SVG markup.
 */
function serializeIconSvg(icon, { xmlns = false, indent = '  ', newline = '\n' } = {}) {
  const rootAttrs = { viewBox: icon.attrs.viewBox, ...icon.attrs };
  const root = `<svg${attributeString(rootAttrs)}${xmlns ? ' xmlns="http://www.w3.org/2000/svg"' : ''}>`;
  const children = icon.nodes.map(([tag, attrs]) => `${indent}<${tag}${attributeString(attrs)}/>`);
  return [root, ...children, '</svg>'].join(newline);
}

/**
 * Serialize only the shape nodes, as the inner markup of an <svg> element.
 */
function serializeIconBody(icon) {
  return icon.nodes.map(([tag, attrs]) => `<${tag}${attributeString(attrs)}/>`).join('');
}

/**
 * Convert a kebab-case SVG attribute name to its camelCase React prop name.
 */
function toCamelCase(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

module.exports = { SHAPE_TAGS, parseIconSvg, readIconFolder, serializeIconSvg, serializeIconBody, toCamelCase };
