import { describe, it, expect } from 'vitest';

import {
  DEFAULT_LANGUAGE_CODE,
  LANGUAGES,
  getLanguageInfo,
  matchAvailableLanguage,
  normalizeLanguageCode,
  resolveDefaultLanguage,
} from '../Languages';

/** The identity generator's supported subset, used to exercise restricted matching. */
const IDENTITY_CODES = ['da', 'de', 'en', 'es', 'fr', 'it', 'nl', 'ro', 'sv', 'ur', 'fa'];
/** The Diceware passphrase wordlist subset (owned by the Rust core). */
const DICEWARE_CODES = ['en', 'nl', 'de', 'fr', 'es', 'it', 'ro'];

describe('Languages', () => {
  describe('normalizeLanguageCode', () => {
    it('takes the first two characters, lowercased', () => {
      expect(normalizeLanguageCode('nl-NL')).toBe('nl');
      expect(normalizeLanguageCode('EN')).toBe('en');
      expect(normalizeLanguageCode('de-CH')).toBe('de');
    });

    it('handles null/undefined/empty', () => {
      expect(normalizeLanguageCode(null)).toBe('');
      expect(normalizeLanguageCode(undefined)).toBe('');
      expect(normalizeLanguageCode('')).toBe('');
    });
  });

  describe('getLanguageInfo', () => {
    it('returns the metadata for a known code', () => {
      const nl = getLanguageInfo('nl');
      expect(nl.code).toBe('nl');
      expect(nl.label).toBe('Nederlands');
      expect(nl.alternativeCodes).toContain('nl-BE');
    });

    it('falls back to a globe + raw code for unknown languages', () => {
      const unknown = getLanguageInfo('xx');
      expect(unknown.flag).toBe('🌐');
      expect(unknown.label).toBe('xx');
    });
  });

  describe('alternativeCodes data', () => {
    it('defines unique, region-tagged alternatives for every language', () => {
      const seen = new Set<string>();
      for (const lang of LANGUAGES) {
        for (const alt of lang.alternativeCodes ?? []) {
          expect(alt.toLowerCase()).not.toBe(lang.code.toLowerCase());
          expect(seen.has(alt.toLowerCase())).toBe(false);
          seen.add(alt.toLowerCase());
        }
      }
    });
  });

  describe('matchAvailableLanguage', () => {
    it('matches an exact available code', () => {
      expect(matchAvailableLanguage('nl', IDENTITY_CODES)).toBe('nl');
    });

    it('maps a region variant via alternativeCodes', () => {
      expect(matchAvailableLanguage('nl-BE', IDENTITY_CODES)).toBe('nl');
      expect(matchAvailableLanguage('de-CH', IDENTITY_CODES)).toBe('de');
      expect(matchAvailableLanguage('en-US', DICEWARE_CODES)).toBe('en');
    });

    it('is case-insensitive', () => {
      expect(matchAvailableLanguage('NL-BE', IDENTITY_CODES)).toBe('nl');
      expect(matchAvailableLanguage('En-Us', IDENTITY_CODES)).toBe('en');
    });

    it('falls back to the base language for unlisted region variants', () => {
      expect(matchAvailableLanguage('en-ZZ', IDENTITY_CODES)).toBe('en');
      expect(matchAvailableLanguage('nl-ZZ', IDENTITY_CODES)).toBe('nl');
    });

    it('returns null when the language is not available', () => {
      // Japanese has no identity generator.
      expect(matchAvailableLanguage('ja', IDENTITY_CODES)).toBeNull();
      // Polish is a known UI language but not a Diceware wordlist.
      expect(matchAvailableLanguage('pl-PL', DICEWARE_CODES)).toBeNull();
    });

    it('returns null for empty/invalid input', () => {
      expect(matchAvailableLanguage(null, IDENTITY_CODES)).toBeNull();
      expect(matchAvailableLanguage(undefined, IDENTITY_CODES)).toBeNull();
      expect(matchAvailableLanguage('', IDENTITY_CODES)).toBeNull();
      expect(matchAvailableLanguage('invalid', IDENTITY_CODES)).toBeNull();
      expect(matchAvailableLanguage('123', IDENTITY_CODES)).toBeNull();
    });
  });

  describe('resolveDefaultLanguage', () => {
    it('returns the matched code when available', () => {
      expect(resolveDefaultLanguage('de-AT', DICEWARE_CODES)).toBe('de');
      expect(resolveDefaultLanguage('nl', DICEWARE_CODES)).toBe('nl');
    });

    it('falls back to the first available code when nothing matches', () => {
      expect(resolveDefaultLanguage('ja', DICEWARE_CODES)).toBe('en');
      expect(resolveDefaultLanguage('pl-PL', DICEWARE_CODES)).toBe('en');
    });

    it('falls back to English when there are no available codes', () => {
      expect(resolveDefaultLanguage('nl', [])).toBe(DEFAULT_LANGUAGE_CODE);
    });
  });
});
