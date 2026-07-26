/**
 * The catalog of built-in icons a user can pick for an item.
 */

/**
 * SVG icon definitions for each built-in icon key.
 * All icons use a 32x32 viewBox for consistency with ItemTypeIconSvgs.
 */
export const AppIconSvgs = {
  Shopping: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 5H7L9.5 19H24L27 9H10" stroke="#f49541" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="11" cy="25" r="2.5" fill="#d68338"/>
  <circle cx="22" cy="25" r="2.5" fill="#d68338"/>
</svg>`,

  Bank: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 4L29 11H3L16 4Z" fill="#f49541"/>
  <rect x="6" y="13" width="3" height="11" fill="#f49541"/>
  <rect x="14.5" y="13" width="3" height="11" fill="#f49541"/>
  <rect x="23" y="13" width="3" height="11" fill="#f49541"/>
  <rect x="3" y="25" width="26" height="3" rx="1" fill="#d68338"/>
</svg>`,

  Mail: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="7" width="26" height="18" rx="3" fill="#f49541"/>
  <path d="M4 10L16 18L28 10" stroke="#ffe096" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,

  Social: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="11" r="5" fill="#f49541"/>
  <path d="M3 27C3 21.5 7 18 12 18C17 18 21 21.5 21 27H3Z" fill="#f49541"/>
  <circle cx="23" cy="12" r="4" fill="#d68338"/>
  <path d="M20 27C20 22 23 19.5 26 19.5C28.5 19.5 30 22 30 27H20Z" fill="#d68338"/>
</svg>`,

  Work: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 8V6C12 5 12.9 4 14 4H18C19.1 4 20 5 20 6V8" stroke="#d68338" stroke-width="2.5" stroke-linecap="round"/>
  <rect x="3" y="8" width="26" height="18" rx="3" fill="#f49541"/>
  <rect x="3" y="15" width="26" height="2.5" fill="#d68338"/>
  <rect x="13.5" y="14" width="5" height="5" rx="1" fill="#ffe096"/>
</svg>`,

  Game: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="9" width="28" height="15" rx="7.5" fill="#f49541"/>
  <rect x="7" y="14" width="6" height="2" rx="1" fill="#ffe096"/>
  <rect x="9" y="12" width="2" height="6" rx="1" fill="#ffe096"/>
  <circle cx="21" cy="14.5" r="1.8" fill="#d68338"/>
  <circle cx="24.5" cy="18" r="1.8" fill="#d68338"/>
</svg>`,

  Media: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="3" y="5" width="26" height="22" rx="4" fill="#f49541"/>
  <path d="M13 11.5L21 16L13 20.5V11.5Z" fill="#ffe096"/>
</svg>`,

  Travel: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M15 3C16.1 3 17 3.9 17 5V12.5L29 19V22L17 18.5V24L20 26.5V29L15 27.5L10 29V26.5L13 24V18.5L1 22V19L13 12.5V5C13 3.9 13.9 3 15 3Z" fill="#f49541"/>
</svg>`,

  Health: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 27C16 27 3 19.5 3 11.5C3 7.4 6.1 4.5 9.8 4.5C12.2 4.5 14.5 5.9 16 8C17.5 5.9 19.8 4.5 22.2 4.5C25.9 4.5 29 7.4 29 11.5C29 19.5 16 27 16 27Z" fill="#f49541"/>
  <path d="M14.5 11H17.5V14H20.5V17H17.5V20H14.5V17H11.5V14H14.5V11Z" fill="#ffe096"/>
</svg>`,

  Dev: `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="5" width="28" height="22" rx="4" fill="#f49541"/>
  <path d="M12 12L8 16.5L12 21" stroke="#ffe096" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M20 12L24 16.5L20 21" stroke="#ffe096" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`,
} as const;

export type AppIconKey = keyof typeof AppIconSvgs;

/**
 * Get the SVG string for a built-in icon key, or null when the key is unknown to this client
 * (a newer version may have added it). Callers fall back to their placeholder icon.
 */
export function getAppIconSvg(key: string): string | null {
  return Object.prototype.hasOwnProperty.call(AppIconSvgs, key) ? AppIconSvgs[key as AppIconKey] : null;
}

/**
 * Get all built-in icon keys, in the order they are offered to the user.
 */
export function getAllAppIconKeys(): AppIconKey[] {
  return Object.keys(AppIconSvgs) as AppIconKey[];
}
