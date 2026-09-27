/**
 * AliasVault logo SVG constants for use across the application.
 * The paths come from src/assets/logo.svg, a copy of core/assets/brand/logo.svg written by core/assets/sync.sh.
 */

import logoSvg from '@/assets/logo.svg?raw';

/** Brand color for the logo, read from the logo file. */
export const LOGO_COLOR = /fill="(#[0-9A-Fa-f]{3,8})"/.exec(logoSvg)![1];

/**
 * Individual path data for the logo mark (viewBox 0 0 500 500), read from the logo file.
 * Use these in React components with <path d={...} fill={LOGO_COLOR} />
 */
export const LOGO_MARK_PATH_DATA: readonly string[] = Array.from(logoSvg.matchAll(/ d="([^"]+)"/g), m => m[1]);

/**
 * Logo mark SVG paths as raw HTML string (without container SVG).
 */
export const LOGO_MARK_PATHS_HTML = LOGO_MARK_PATH_DATA
  .map(d => `<path d="${d}" fill="${LOGO_COLOR}"/>`)
  .join('\n');

/**
 * Complete logo mark SVG with 500x500 viewBox.
 */
export const LOGO_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" fill="none">${LOGO_MARK_PATHS_HTML}</svg>`;

/**
 * Get logo mark SVG with custom dimensions.
 * @param width - Width in pixels
 * @param height - Height in pixels
 */
export function getLogoMarkSvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 500 500" fill="none">${LOGO_MARK_PATHS_HTML}</svg>`;
}
