import { getLocales, useLocales } from 'expo-localization';
import i18n from 'i18next';
import { useEffect } from 'react';
import { initReactI18next } from 'react-i18next';

import { ALL_TRANSLATIONS } from '@aliasvault/i18n/all';
import { DEFAULT_LANGUAGE, LANGUAGE_CODES, matchAvailableLanguage } from '@aliasvault/i18n/languages';

const resources = Object.fromEntries(Object.entries(ALL_TRANSLATIONS).map(([code, translation]) => [code, { translation }]));

/**
 * The UI language for a system locale tag.
 * @param languageTag - the system locale tag, e.g. 'pt-BR'
 */
const resolveLanguage = (languageTag: string | undefined): string => matchAvailableLanguage(languageTag, LANGUAGE_CODES) ?? DEFAULT_LANGUAGE;

/**
 * Initialize i18n configuration
 */
const initI18n = async (): Promise<void> => {
  // Always use system language, no custom storage
  const selectedLanguage = resolveLanguage(getLocales()[0]?.languageTag);

  // eslint-disable-next-line import/no-named-as-default-member
  await i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: selectedLanguage,
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    });
};

/**
 * Follows a system language change while the app runs: Android keeps MainActivity on a locale change (configChanges) instead of recreating it.
 */
const useSystemLanguage = (): void => {
  const locales = useLocales();

  useEffect(() => {
    const language = resolveLanguage(locales[0]?.languageTag);
    if (i18n.isInitialized && language !== i18n.language) {
      // eslint-disable-next-line import/no-named-as-default-member
      void i18n.changeLanguage(language);
    }
  }, [locales]);
};

export { initI18n, useSystemLanguage };
export default i18n;
