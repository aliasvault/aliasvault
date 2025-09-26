import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import de from './locales/de.json';
import en from './locales/en.json';
import fi from './locales/fi.json';
import he from './locales/he.json';
import it from './locales/it.json';
import nl from './locales/nl.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import uk from './locales/uk.json';
import zh from './locales/zh.json';

const resources = {
  de: { translation: de },
  en: { translation: en },
  fi: { translation: fi },
  he: { translation: he },
  nl: { translation: nl },
  it: { translation: it },
  pt: { translation: pt },
  ru: { translation: ru },
  uk: { translation: uk },
  zh: { translation: zh },
};

/**
 * Initialize i18n configuration
 */
const initI18n = async (): Promise<void> => {
  // Always use system language, no custom storage
  const locales = getLocales();
  const deviceLanguage = locales[0]?.languageCode ?? 'en';
  const selectedLanguage = resources[deviceLanguage as keyof typeof resources] ? deviceLanguage : 'en';

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

export { initI18n };
export default i18n;