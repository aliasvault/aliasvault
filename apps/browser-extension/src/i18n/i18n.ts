import { ALL_TRANSLATIONS } from '@aliasvault/i18n/all';
import { matchAvailableLanguage } from '@aliasvault/i18n/languages';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { StorageKeys } from '@/utils/constants/storageKeys';
import { logFailure } from '@/utils/Diagnostics';

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES
} from './config';

import { storage } from '#imports';

// Detect browser language
/**
 * Detect the user's preferred language from localStorage or browser settings
 */
const detectLanguage = async (): Promise<string> => {
  const stored = await storage.getItem(StorageKeys.LANGUAGE) as string;
  return matchAvailableLanguage(stored, LANGUAGE_CODES) ?? matchAvailableLanguage(navigator.language, LANGUAGE_CODES) ?? DEFAULT_LANGUAGE;
};

/**
 * Initialize i18n with async language detection
 */
const initI18n = async (): Promise<void> => {
  const language = await detectLanguage();
  /*
   * The extension build puts each entry point in one file (no code splitting), so the popup bundles every language
   * up front; the background and content scripts only bundle the namespaces they use (config.ts).
   */
  const resources = Object.fromEntries(Object.entries(ALL_TRANSLATIONS).map(([code, translation]) => [code, { translation }]));

  await i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: language,
      fallbackLng: DEFAULT_LANGUAGE,

      debug: false, // Set to true for development debugging

      interpolation: {
        escapeValue: false // React already escapes
      },

      react: {
        useSuspense: false, // Important for browser extensions
        bindI18n: 'languageChanged loaded', // Bind to language change and loaded events
        bindI18nStore: '' // Don't bind to resource store changes
      }
    });
};

// Initialize immediately and handle potential errors
initI18n().catch((error) => {
  logFailure('Failed to initialize i18n', error);
  // Even if initialization fails, emit initialized event to prevent app from hanging
  i18n.emit('initialized');
});

export default i18n;