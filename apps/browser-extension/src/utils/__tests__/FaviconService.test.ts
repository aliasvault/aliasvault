import { describe, it, expect } from 'vitest';

import { FaviconService } from '@/utils/FaviconService';

describe('FaviconService', () => {
  describe('normalizeUrl', () => {
    it('keeps an absolute URL as-is', () => {
      expect(FaviconService.normalizeUrl('https://github.com/login')).toBe('https://github.com/login');
      expect(FaviconService.normalizeUrl('http://example.org')).toBe('http://example.org');
    });

    it('accepts a bare host, which is what extractSourceFromUrl reads a domain from', () => {
      /*
       * The two must agree: a URL we store an icon Source for has to be one we also fetch a favicon
       * for, otherwise typing "youtube.com" resolves a domain but never fetches its icon.
       */
      expect(FaviconService.normalizeUrl('youtube.com')).toBe('https://youtube.com');
      expect(FaviconService.normalizeUrl('www.github.com/login')).toBe('https://www.github.com/login');
      expect(FaviconService.extractSourceFromUrl('youtube.com')).toBe('youtube.com');
    });

    it('rejects values that are not hosts', () => {
      expect(FaviconService.normalizeUrl('not a url')).toBeUndefined();
      expect(FaviconService.normalizeUrl('localhost')).toBeUndefined();
      expect(FaviconService.normalizeUrl('   ')).toBeUndefined();
      expect(FaviconService.normalizeUrl(null)).toBeUndefined();
    });
  });

  describe('extractFirstValidUrl', () => {
    it('picks the first entry a domain can be read from', () => {
      expect(FaviconService.extractFirstValidUrl(['not a url', 'youtube.com'])).toBe('https://youtube.com');
      expect(FaviconService.extractFirstValidUrl('https://github.com')).toBe('https://github.com');
    });

    it('returns undefined when nothing in the field is a URL', () => {
      expect(FaviconService.extractFirstValidUrl(['', 'nonsense'])).toBeUndefined();
      expect(FaviconService.extractFirstValidUrl(undefined)).toBeUndefined();
    });
  });

  describe('extractSourceFromUrl', () => {
    it('normalizes case and strips www', () => {
      expect(FaviconService.extractSourceFromUrl('https://WWW.GitHub.com/path')).toBe('github.com');
    });

    it('reports unknown for values it cannot parse', () => {
      expect(FaviconService.extractSourceFromUrl('not a url')).toBe('unknown');
      expect(FaviconService.extractSourceFromUrl('')).toBe('unknown');
    });
  });
});
