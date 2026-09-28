#!/usr/bin/env node
/*
 * Generates the native translation files of the mobile app (iOS .strings, Android strings.xml) from the shared
 * translations in core/i18n/locales, using the map in core/i18n/exports/mobile-native.json.
 *
 *   node core/i18n/scripts/export-native.mjs           # write the files
 *   node core/i18n/scripts/export-native.mjs --check   # exit 1 when a generated file is out of date
 *
 * Languages are the UI languages of LANGUAGE_CODES in src/index.ts. A missing translation falls back to English.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const I18N_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(I18N_DIR, '../..');
const CHECK = process.argv.includes('--check');
const GENERATED_NOTE = 'Generated from core/i18n/locales by core/i18n/scripts/export-native.mjs. Do not edit, change core/i18n instead.';

const codesMatch = /LANGUAGE_CODES = \[([^\]]+)\]/.exec(readFileSync(path.join(I18N_DIR, 'src/index.ts'), 'utf8'));
if (!codesMatch) {
  throw new Error('LANGUAGE_CODES not found in src/index.ts');
}
const languages = [...codesMatch[1].matchAll(/'([a-z]{2})'/g)].map((m) => m[1]);
const { targets } = JSON.parse(readFileSync(path.join(I18N_DIR, 'exports/mobile-native.json'), 'utf8'));
const locales = Object.fromEntries(languages.map((lang) => [lang, JSON.parse(readFileSync(path.join(I18N_DIR, `locales/${lang}.json`), 'utf8'))]));

/**
 * Read a dotted key from a translation tree.
 * @param {Record<string, unknown>} tree
 * @param {string} key
 */
const lookup = (tree, key) => key.split('.').reduce((node, segment) => (node && typeof node === 'object' ? node[segment] : undefined), tree);

/**
 * The text of a shared key in a language (English fallback), with its placeholders in the native format.
 * @param {string} lang
 * @param {string | { key: string, format?: Record<string, string> }} spec
 * @param {string} platform
 * @param {string} where - used in error messages
 */
function resolve(lang, spec, platform, where) {
  const { key, format = {} } = typeof spec === 'string' ? { key: spec } : spec;
  const english = lookup(locales.en, key);
  if (typeof english !== 'string') {
    throw new Error(`${where}: shared key "${key}" does not exist in en.json`);
  }
  const translated = lookup(locales[lang], key);
  let text = typeof translated === 'string' && translated.length > 0 ? translated : english;
  for (const [name, specifier] of Object.entries(format)) {
    text = text.split(`{{${name}}}`).join(specifier);
  }
  /* iOS code replaces the remaining {{name}} placeholders itself; Android only knows format specifiers. */
  if (platform === 'android' && /\{\{\w+\}\}/.test(text)) {
    throw new Error(`${where}: "${key}" has a placeholder without an Android format specifier`);
  }
  return text;
}

/**
 * Escape a value for an Apple .strings file.
 * @param {string} value
 */
const escapeStrings = (value) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

/**
 * Escape a value for an Android string resource.
 * @param {string} value
 */
const escapeAndroid = (value) => value
  .replace(/\\/g, '\\\\')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/'/g, "\\'")
  .replace(/"/g, '\\"')
  .replace(/\n/g, '\\n')
  .replace(/^([@?])/, '\\$1');

/**
 * Render one native file.
 * @param {Record<string, any>} target
 * @param {string} lang
 */
function render(target, lang) {
  const entries = Object.entries(target.strings).map(([nativeKey, spec]) => [nativeKey, resolve(lang, spec, target.platform, `${target.path} ${nativeKey}`)]);
  if (target.platform === 'ios') {
    const lines = [`/* ${target.comment}. ${GENERATED_NOTE} */`, ...entries.map(([k, v]) => `"${escapeStrings(k)}" = "${escapeStrings(v)}";`)];
    return `${lines.join('\n')}\n`;
  }
  const constants = lang === 'en' ? Object.entries(target.constants ?? {}).map(([k, v]) => `  <string name="${k}" translatable="false">${escapeAndroid(v)}</string>`) : [];
  const strings = entries.map(([k, v]) => `  <string name="${k}">${escapeAndroid(v)}</string>`);
  return `<?xml version="1.0" encoding="utf-8"?>\n<!-- ${target.comment}. ${GENERATED_NOTE} -->\n<resources>\n${[...constants, ...strings].join('\n')}\n</resources>\n`;
}

const stale = [];
let written = 0;
for (const target of targets) {
  for (const lang of languages) {
    const relative = target.path.replace('{lang}', lang).replace('{-lang}', lang === 'en' ? '' : `-${lang}`);
    const file = path.join(REPO_ROOT, relative);
    const content = render(target, lang);
    const current = existsSync(file) ? readFileSync(file) : undefined;
    if (current && current.equals(Buffer.from(content, 'utf8'))) {
      continue;
    }
    if (CHECK) {
      stale.push(relative);
      continue;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    written++;
  }
}

if (CHECK) {
  if (stale.length > 0) {
    console.error(`Native translation files are out of date, run "node core/i18n/scripts/export-native.mjs":\n${stale.join('\n')}`);
    process.exit(1);
  }
  console.info('Native translation files are up to date.');
} else {
  console.info(`Wrote ${written} native translation file(s).`);
}
