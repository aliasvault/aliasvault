import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { getLocalPreference, setLocalPreference } from '@/utils/LocalPreferences';
import { LocalPreferenceKeys } from '@/utils/StorageKeys';

import { DEFAULT_LANGUAGE, LANGUAGE_CODES, LANGUAGE_RESOURCES } from './config';

/**
 * Detect the user's preferred language: the saved preference, else the browser language, else English.
 */
export const detectLanguage = (): string => {
  const stored = getLocalPreference(LocalPreferenceKeys.APP_LANGUAGE);
  if (stored && LANGUAGE_CODES.includes(stored)) {
    return stored;
  }

  const browserLang = navigator.language.split('-')[0];
  return LANGUAGE_CODES.includes(browserLang) ? browserLang : DEFAULT_LANGUAGE;
};

/**
 * Switch the UI language and remember the choice.
 * @param code - the language code
 */
export const changeLanguage = async (code: string): Promise<void> => {
  setLocalPreference(LocalPreferenceKeys.APP_LANGUAGE, code);
  await i18n.changeLanguage(code);
};

/**
 * Initialize i18n. Must complete before the app renders.
 */
export const initI18n = async (): Promise<void> => {
  if (i18n.isInitialized) {
    return;
  }

  await i18n
    .use(initReactI18next)
    .init({
      resources: LANGUAGE_RESOURCES,
      lng: detectLanguage(),
      fallbackLng: DEFAULT_LANGUAGE,
      debug: false,
      interpolation: {
        escapeValue: false, // React already escapes
      },
      react: {
        useSuspense: false,
        bindI18n: 'languageChanged loaded',
        bindI18nStore: '',
      },
    });
};

export default i18n;
