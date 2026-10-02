import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/components/shared/Icon';
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
        aria-label={t('settings.language')}
        className="appearance-none cursor-pointer pl-3 pr-9 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-800">
        {AVAILABLE_LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>{language.flag} {language.nativeName}</option>
        ))}
      </select>
      <Icon name="chevron-down" className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 dark:text-gray-400" />
    </div>
  );
};

export default LanguageSwitcher;
