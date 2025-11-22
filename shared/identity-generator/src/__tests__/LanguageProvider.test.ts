import { describe, it, expect } from 'vitest';
import { getAvailableLanguages, mapUiLanguageToIdentityLanguage } from '../utils/LanguageProvider';

describe('LanguageProvider', () => {
  describe('getAvailableLanguages', () => {
    it('should return a list of available languages', () => {
      const languages = getAvailableLanguages();

      expect(languages).toBeDefined();
      expect(languages.length).toBeGreaterThan(0);
      expect(languages[0]).toHaveProperty('value');
      expect(languages[0]).toHaveProperty('label');
      expect(languages[0]).toHaveProperty('flag');
    });
  });

  describe('mapUiLanguageToIdentityLanguage', () => {
    describe('Dutch mappings', () => {
      it('should map "nl" to "nl"', () => {
        expect(mapUiLanguageToIdentityLanguage('nl')).toBe('nl');
      });

      it('should map "nl-NL" to "nl"', () => {
        expect(mapUiLanguageToIdentityLanguage('nl-NL')).toBe('nl');
      });

      it('should map "nl-BE" to "nl" (Belgian Dutch)', () => {
        expect(mapUiLanguageToIdentityLanguage('nl-BE')).toBe('nl');
      });

      it('should be case-insensitive for "NL"', () => {
        expect(mapUiLanguageToIdentityLanguage('NL')).toBe('nl');
      });

      it('should be case-insensitive for "NL-NL"', () => {
        expect(mapUiLanguageToIdentityLanguage('NL-NL')).toBe('nl');
      });

      it('should be case-insensitive for "NL-BE"', () => {
        expect(mapUiLanguageToIdentityLanguage('NL-BE')).toBe('nl');
      });
    });

    describe('Edge cases', () => {
      it('should return null for null input', () => {
        expect(mapUiLanguageToIdentityLanguage(null)).toBe(null);
      });

      it('should return null for undefined input', () => {
        expect(mapUiLanguageToIdentityLanguage(undefined)).toBe(null);
      });

      it('should return null for empty string', () => {
        expect(mapUiLanguageToIdentityLanguage('')).toBe(null);
      });

      it('should return null for whitespace', () => {
        expect(mapUiLanguageToIdentityLanguage('   ')).toBe(null);
      });

      it('should return null for invalid format', () => {
        expect(mapUiLanguageToIdentityLanguage('invalid')).toBe(null);
      });

      it('should return null for numbers', () => {
        expect(mapUiLanguageToIdentityLanguage('123')).toBe(null);
      });
    });

    describe('Mixed case and locale variants', () => {
      it('should handle mixed case "En-Us"', () => {
        expect(mapUiLanguageToIdentityLanguage('En-Us')).toBe('en');
      });

      it('should handle mixed case "nL-Nl"', () => {
        expect(mapUiLanguageToIdentityLanguage('nL-Nl')).toBe('nl');
      });

      it('should extract base language from unknown locale "en-ZZ"', () => {
        expect(mapUiLanguageToIdentityLanguage('en-ZZ')).toBe('en');
      });

      it('should extract base language from unknown locale "nl-ZZ"', () => {
        expect(mapUiLanguageToIdentityLanguage('nl-ZZ')).toBe('nl');
      });
    });
  });
});
