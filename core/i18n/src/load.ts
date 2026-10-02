/**
 * Lazy loading of the locale files for hosts with code splitting (the web app).
 */

import en from '../locales/en.json';

import { isLanguageCode } from './languages';

import type { TranslationTree } from './index';

/**
 * Import the locale file of a language. One static import per language, so bundlers that support code splitting only
 * load the language in use.
 * @param code - the language code
 */
async function importLocale(code: string): Promise<{ default: TranslationTree }> {
  switch (code) {
    case 'da': return import('../locales/da.json');
    case 'de': return import('../locales/de.json');
    case 'es': return import('../locales/es.json');
    case 'fi': return import('../locales/fi.json');
    case 'fr': return import('../locales/fr.json');
    case 'ga': return import('../locales/ga.json');
    case 'he': return import('../locales/he.json');
    case 'hu': return import('../locales/hu.json');
    case 'id': return import('../locales/id.json');
    case 'it': return import('../locales/it.json');
    case 'nl': return import('../locales/nl.json');
    case 'pl': return import('../locales/pl.json');
    case 'pt': return import('../locales/pt.json');
    case 'ro': return import('../locales/ro.json');
    case 'ru': return import('../locales/ru.json');
    case 'sv': return import('../locales/sv.json');
    case 'uk': return import('../locales/uk.json');
    case 'zh': return import('../locales/zh.json');
    default: return { default: en };
  }
}

/**
 * Load the translations of one language, English for an unknown code.
 * @param code - the language code
 */
export async function loadTranslations(code: string): Promise<TranslationTree> {
  return isLanguageCode(code) ? (await importLocale(code)).default : en;
}
