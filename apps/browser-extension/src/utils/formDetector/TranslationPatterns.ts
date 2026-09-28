/**
 * This module extracts field detection patterns from all available translation files.
 * It looks at common.email, common.username, and common.password translations
 * across all supported languages to help detect form fields in any language.
 *
 * It imports the common namespace of every shared translation file (core/i18n), so adding a new
 * language automatically extends form detection support without any code changes.
 */

/**
 * The common namespace of every language in the shared translation files; only that namespace is bundled.
 */
const translationModules = import.meta.glob('../../../../../core/i18n/locales/*.json', { eager: true, import: 'common' });

/**
 * All translation objects, shaped like a locale file (only common is present).
 */
const allTranslations = Object.values(translationModules).map((common: unknown) => ({ common }));

/**
 * Extract unique, lowercase field patterns from all translations
 * for a given key path (e.g., 'common.email')
 */
function extractPatternsFromTranslations(keyPath: string): string[] {
  const patterns = new Set<string>();

  for (const translation of allTranslations) {
    const value = getNestedValue(translation, keyPath);
    if (value && typeof value === 'string') {
      // Normalize and split multi-word translations
      const normalized = value.toLowerCase().trim();

      // Add the full phrase
      patterns.add(normalized);
    }
  }

  return Array.from(patterns);
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Email patterns extracted from all translation files
 * These are combined with the existing email patterns for better detection
 */
export const TranslationEmailPatterns: string[] = extractPatternsFromTranslations('common.email');

/**
 * Username patterns extracted from all translation files
 * These are combined with the existing username patterns for better detection
 */
export const TranslationUsernamePatterns: string[] = extractPatternsFromTranslations('common.username');

/**
 * Password patterns extracted from all translation files
 * These are combined with the existing password patterns for better detection
 */
export const TranslationPasswordPatterns: string[] = extractPatternsFromTranslations('common.password');

/**
 * Combined patterns that include both translation-based and hardcoded patterns
 * This ensures we catch fields in all supported languages
 */
export const AllLanguagePatterns = {
  email: TranslationEmailPatterns,
  username: TranslationUsernamePatterns,
  password: TranslationPasswordPatterns
};
