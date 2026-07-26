import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { StorageKeys } from '@/utils/constants/storageKeys';

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES,
  LANGUAGE_RESOURCES
} from './config';

import { storage } from '#imports';

// Detect browser language
/**
 * Detect the user's preferred language from localStorage or browser settings
 */
const detectLanguage = async (): Promise<string> => {
  // Check localStorage first
  const stored = await storage.getItem(StorageKeys.LANGUAGE) as string;
  if (stored && LANGUAGE_CODES.includes(stored)) {
    return stored;
  }

  // Fall back to browser language
  const browserLang = navigator.language.split('-')[0];
  return LANGUAGE_CODES.includes(browserLang) ? browserLang : DEFAULT_LANGUAGE;
};

/**
 * Initialize i18n with async language detection
 */
const initI18n = async (): Promise<void> => {
  const language = await detectLanguage();

  await i18n
    .use(initReactI18next)
    .init({
      resources: LANGUAGE_RESOURCES,
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
  console.error('Failed to initialize i18n:', error);
  // Even if initialization fails, emit initialized event to prevent app from hanging
  i18n.emit('initialized');
});

export default i18n;