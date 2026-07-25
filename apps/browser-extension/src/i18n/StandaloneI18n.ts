/**
 * Standalone i18n for non-React contexts.
 * This is used to translate strings in non-React contexts, such as the background and content scripts.
 */

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_CODES,
  loadTranslations,
  getNestedValue
} from './config';

import { storage } from '#imports';
import { StorageKeys } from '@/utils/constants/storageKeys';

/**
 * Get current language from storage
 */
export async function getCurrentLanguage(): Promise<string> {
  try {
    // Use extension storage API exclusively (reliable across all contexts)
    const langFromStorage = await storage.getItem(StorageKeys.LANGUAGE) as string;
    if (langFromStorage && LANGUAGE_CODES.includes(langFromStorage)) {
      return langFromStorage;
    }

    // If no language is set in storage, detect browser language and save it
    const browserLang = navigator.language.split('-')[0];
    const detectedLanguage = LANGUAGE_CODES.includes(browserLang) ? browserLang : DEFAULT_LANGUAGE;

    // Save the detected language to storage for future use
    await storage.setItem(StorageKeys.LANGUAGE, detectedLanguage);

    return detectedLanguage;
  } catch (error) {
    console.error('Failed to get current language:', error);
    return DEFAULT_LANGUAGE;
  }
}

/**
 * Translation function for non-React contexts
 *
 * @param key - Translation key (supports nested keys like 'auth.loginButton' or 'common.errors.networkError')
 * @param fallback - Fallback text if translation is not found
 * @returns Promise<string> - Translated text
 */
export async function t(
  key: string,
  fallback?: string
): Promise<string> {
  try {
    const language = await getCurrentLanguage();
    const translations = await loadTranslations(language);

    // Support nested keys like 'auth.loginButton' or 'common.errors.networkError'
    const value = getNestedValue(translations, key);

    if (value && typeof value === 'string') {
      return value;
    }

    // If translation not found and we're not using English, try English fallback
    if (language !== DEFAULT_LANGUAGE) {
      const englishTranslations = await loadTranslations(DEFAULT_LANGUAGE);
      const englishValue = getNestedValue(englishTranslations, key);

      if (englishValue && typeof englishValue === 'string') {
        return englishValue;
      }
    }

    // Return fallback or key if no translation found
    return fallback || key;
  } catch (error) {
    console.error('Translation error:', error);
    return fallback || key;
  }
}
