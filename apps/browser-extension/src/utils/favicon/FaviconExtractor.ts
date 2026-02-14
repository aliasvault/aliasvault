/**
 * Utility for extracting favicon URLs from the DOM.
 *
 * Used by:
 * - LoginDetector: for capturing favicon URL when detecting login submissions
 * - Popup.ts: for fetching favicon bytes when creating new credentials
 */

/**
 * Selectors for finding favicon elements, in priority order.
 * Order matters: earlier selectors are preferred (higher quality icons).
 */
const FAVICON_SELECTORS = [
  // SVG icons (scalable, high quality)
  'link[rel="icon"][type="image/svg+xml"]',
  // Size-specific icons (in order of preference)
  'link[rel="icon"][sizes="96x96"]',
  'link[rel="icon"][sizes="128x128"]',
  'link[rel="icon"][sizes="48x48"]',
  'link[rel="icon"][sizes="32x32"]',
  'link[rel="icon"][sizes="192x192"]',
  // Apple touch icons (usually high quality)
  'link[rel="apple-touch-icon"]',
  'link[rel="apple-touch-icon-precomposed"]',
  // Generic icon links
  'link[rel="icon"]',
  'link[rel="shortcut icon"]',
] as const;

/**
 * Simple selectors for basic favicon extraction (faster, less comprehensive).
 */
const SIMPLE_FAVICON_SELECTORS = [
  'link[rel="icon"]',
  'link[rel="shortcut icon"]',
  'link[rel="apple-touch-icon"]',
  'link[rel="apple-touch-icon-precomposed"]',
] as const;

/**
 * Result of favicon extraction.
 */
export interface IFaviconExtractionResult {
  /** The favicon URL, or undefined if not found */
  url: string | undefined;
  /** Whether a fallback was used (e.g., /favicon.ico) */
  isFallback: boolean;
}

/**
 * Extract the best available favicon URL from the document.
 * Uses a prioritized list of selectors to find the highest quality icon.
 *
 * @param doc - The document to search for favicon links
 * @param includeFallback - Whether to fall back to /favicon.ico if no link found (default: true)
 * @returns IFaviconExtractionResult with the URL and whether it's a fallback
 */
export function extractFaviconUrl(
  doc: Document,
  includeFallback: boolean = true
): IFaviconExtractionResult {
  // Try each selector in priority order
  for (const selector of FAVICON_SELECTORS) {
    const link = doc.querySelector<HTMLLinkElement>(selector);
    if (link?.href) {
      return { url: link.href, isFallback: false };
    }
  }

  // Fall back to default favicon location
  if (includeFallback) {
    try {
      return {
        url: `${window.location.origin}/favicon.ico`,
        isFallback: true,
      };
    } catch {
      // window.location might not be available in some contexts
      return { url: undefined, isFallback: false };
    }
  }

  return { url: undefined, isFallback: false };
}

/**
 * Extract favicon URL using simple selectors (faster, for basic use cases).
 * Use this when you just need any favicon URL without size optimization.
 *
 * @param doc - The document to search for favicon links
 * @param includeFallback - Whether to fall back to /favicon.ico if no link found (default: true)
 * @returns The favicon URL, or undefined if not found
 */
export function extractFaviconUrlSimple(
  doc: Document,
  includeFallback: boolean = true
): string | undefined {
  for (const selector of SIMPLE_FAVICON_SELECTORS) {
    const link = doc.querySelector<HTMLLinkElement>(selector);
    if (link?.href) {
      return link.href;
    }
  }

  if (includeFallback) {
    try {
      return `${window.location.origin}/favicon.ico`;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Get all favicon link elements from the document.
 * Returns them in priority order (best quality first).
 *
 * @param doc - The document to search for favicon links
 * @param includeFallback - Whether to include /favicon.ico as the last option (default: true)
 * @returns Array of HTMLLinkElements (or a fallback object with href property)
 */
export function getAllFaviconLinks(
  doc: Document,
  includeFallback: boolean = true
): Array<{ href: string }> {
  const links: Array<{ href: string }> = [];
  const seenUrls = new Set<string>();

  for (const selector of FAVICON_SELECTORS) {
    const elements = doc.querySelectorAll<HTMLLinkElement>(selector);
    for (const link of elements) {
      if (link.href && !seenUrls.has(link.href)) {
        seenUrls.add(link.href);
        links.push(link);
      }
    }
  }

  // Add fallback as last option
  if (includeFallback) {
    try {
      const fallbackUrl = `${window.location.origin}/favicon.ico`;
      if (!seenUrls.has(fallbackUrl)) {
        links.push({ href: fallbackUrl });
      }
    } catch {
      // window.location might not be available
    }
  }

  return links;
}
