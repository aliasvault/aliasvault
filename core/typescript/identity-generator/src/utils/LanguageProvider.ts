/**
 * The set of languages the identity generator can produce identities for.
 */
const SUPPORTED_LANGUAGE_CODES: string[] = [
  'da',
  'de',
  'en',
  'es',
  'fr',
  'it',
  'nl',
  'ro',
  'sv',
  'ur',
  'fa',
];

/**
 * Gets all available language codes for identity generation.
 * @returns Array of ISO language codes (e.g. ["da", "de", "en", ...]).
 */
export function getAvailableLanguages(): string[] {
  return [...SUPPORTED_LANGUAGE_CODES];
}
