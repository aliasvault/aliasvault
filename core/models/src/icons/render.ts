import { UiIcons, type UiIconName } from './UiIcons';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Extra root attributes for a rendered icon, keyed by SVG attribute name (class, width, stroke-width, ...).
 */
export type UiIconAttributes = Readonly<Record<string, string | number>>;

/**
 * The parts of a DOM Document needed to build an icon element, so this module does not depend on the DOM typings.
 */
export type SvgDocument = {
  createElementNS(namespace: string, tag: string): SvgElementLike;
};

/**
 * The parts of a DOM Element needed to build an icon element.
 */
export type SvgElementLike = {
  setAttribute(name: string, value: string): void;
  appendChild(child: SvgElementLike): unknown;
};

/**
 * Convert a camelCase prop name to its SVG attribute name (strokeWidth becomes stroke-width).
 */
function toAttributeName(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * Escape a value for use inside a double-quoted attribute.
 */
function escapeAttribute(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * The root attributes of an icon merged with the caller's, as SVG attribute names.
 */
function rootAttributes(name: UiIconName, attrs: UiIconAttributes): [string, string | number][] {
  const icon = UiIcons[name];
  const merged: Record<string, string | number> = { viewBox: icon.viewBox };
  if (!('aria-label' in attrs)) {
    merged['aria-hidden'] = 'true';
  }
  for (const [key, value] of Object.entries(icon.attrs)) {
    merged[toAttributeName(key)] = value;
  }
  return Object.entries({ ...merged, ...attrs });
}

/**
 * Render a UI icon as SVG markup, for code that builds HTML strings (content scripts).
 */
export function uiIconSvg(name: UiIconName, attrs: UiIconAttributes = {}): string {
  const root = rootAttributes(name, attrs).map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('');
  const body = UiIcons[name].nodes.map(([tag, nodeAttrs]) => {
    const props = Object.entries(nodeAttrs).map(([key, value]) => ` ${toAttributeName(key)}="${escapeAttribute(value)}"`).join('');
    return `<${tag}${props}/>`;
  }).join('');
  return `<svg xmlns="${SVG_NAMESPACE}"${root}>${body}</svg>`;
}

/**
 * Build a UI icon as a DOM element, for code that creates elements directly (content scripts).
 */
export function createUiIconElement<T = SvgElementLike>(doc: SvgDocument, name: UiIconName, attrs: UiIconAttributes = {}): T {
  const svg = doc.createElementNS(SVG_NAMESPACE, 'svg');
  for (const [key, value] of rootAttributes(name, attrs)) {
    svg.setAttribute(key, String(value));
  }
  for (const [tag, nodeAttrs] of UiIcons[name].nodes) {
    const node = doc.createElementNS(SVG_NAMESPACE, tag);
    for (const [key, value] of Object.entries(nodeAttrs)) {
      node.setAttribute(toAttributeName(key), value);
    }
    svg.appendChild(node);
  }
  return svg as unknown as T;
}
