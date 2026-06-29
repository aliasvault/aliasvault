import { describe, it, expect } from 'vitest';
import { getAvailableLanguages } from '../utils/LanguageProvider';

describe('LanguageProvider', () => {
  describe('getAvailableLanguages', () => {
    it('should return a list of available language codes', () => {
      const languages = getAvailableLanguages();

      expect(languages).toBeDefined();
      expect(languages.length).toBeGreaterThan(0);
      expect(languages.every(code => typeof code === 'string')).toBe(true);
      expect(languages).toContain('en');
      expect(languages).toContain('nl');
    });
  });
});
