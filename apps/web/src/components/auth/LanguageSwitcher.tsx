import React from 'react';
import { useTranslation } from 'react-i18next';

import { AVAILABLE_LANGUAGES } from '@/i18n/config';
import { changeLanguage } from '@/i18n/i18n';

/**
 * Language selector shown on the auth pages.
 */
const LanguageSwitcher: React.FC = () => {
  const { t, i18n } = useTranslation();

  return (
    <div className="relative inline-block">
      <select
        value={i18n.language}
        onChange={(e) => void changeLanguage(e.target.value)}
        aria-label={t('pages.main.settings.general.AppLanguageLabel')}
        className="appearance-none cursor-pointer pl-3 pr-9 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-800">
        {AVAILABLE_LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>{language.flag} {language.nativeName}</option>
        ))}
      </select>
      <svg className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m19 9-7 7-7-7"></path>
      </svg>
    </div>
  );
};

export default LanguageSwitcher;
