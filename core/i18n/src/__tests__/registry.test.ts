import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ALL_TRANSLATIONS } from '../all';
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, LANGUAGES, loadTranslations } from '../index';

const localesDir = path.resolve(import.meta.dirname, '../../locales');

describe('language registry', () => {
  it('lists English first and every code once', () => {
    expect(LANGUAGE_CODES[0]).toBe(DEFAULT_LANGUAGE);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
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
