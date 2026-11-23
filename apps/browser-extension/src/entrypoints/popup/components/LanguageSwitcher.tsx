import React from 'react';
import { useTranslation } from 'react-i18next';

import { StorageKeys } from '@/utils/constants/storageKeys';

import { AVAILABLE_LANGUAGES } from '../../../i18n/config';

import { storage } from '#imports';

/**
 * Language selector that switches the UI language and stores the choice.
 * @returns JSX element for the language selector
 */
const LanguageSwitcher: React.FC = (): React.JSX.Element => {
  const { t, i18n } = useTranslation();

  /**
   * Change the application language
   * @param lng - Language code to switch to
   */
  const changeLanguage = async (lng: string): Promise<void> => {
    await i18n.changeLanguage(lng);
    await storage.setItem(StorageKeys.LANGUAGE, lng);

    // Force immediate re-render by dispatching the event that react-i18next listens to
    i18n.emit('languageChanged', lng);
  };

  return (
    <select
      value={i18n.language}
      onChange={(e) => void changeLanguage(e.target.value)}
      aria-label={t('settings.language')}
      className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-primary-500 focus:border-primary-500"
    >
      {AVAILABLE_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.flag} {language.nativeName}</option>)}
    </select>
  );
};

export default LanguageSwitcher;
