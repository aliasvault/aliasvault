import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_TRANSLATIONS } from '../all';
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, LANGUAGES, UI_LANGUAGES } from '../index';
import { loadTranslations } from '../load';

const localesDir = path.resolve(import.meta.dirname, '../../locales');

describe('language registry', () => {
  it('lists English first and every code once', () => {
    expect(LANGUAGE_CODES[0]).toBe(DEFAULT_LANGUAGE);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
    expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGE_CODES.length);
  });

  it('has display info for every UI language', () => {
    for (const code of LANGUAGE_CODES) {
      expect(LANGUAGES.some((l) => l.code === code), `languages entry for ${code}`).toBe(true);
    }
    expect(UI_LANGUAGES.map((l) => l.code)).toEqual(LANGUAGE_CODES);
  });

  it('has a locale file, a loader and a bundled entry for every UI language', async () => {
    const english = JSON.parse(readFileSync(path.join(localesDir, 'en.json'), 'utf8'));
    for (const code of LANGUAGE_CODES) {
      expect(existsSync(path.join(localesDir, `${code}.json`)), `${code}.json`).toBe(true);
      expect(ALL_TRANSLATIONS[code], `ALL_TRANSLATIONS.${code}`).toBeDefined();
      const loaded = await loadTranslations(code);
      expect(Object.keys(loaded), `loadTranslations('${code}')`).toEqual(Object.keys(english));
    }
    expect(Object.keys(ALL_TRANSLATIONS).sort()).toEqual([...LANGUAGE_CODES].sort());
  });
});
