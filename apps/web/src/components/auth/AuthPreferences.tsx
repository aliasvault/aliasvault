import React from 'react';
import { useTranslation } from 'react-i18next';

import LanguageSwitcher from '@/components/auth/LanguageSwitcher';
import Icon from '@/components/shared/Icon';
import { useTheme } from '@/context/ThemeContext';

/**
 * Theme toggle and language selector shown on the auth pages.
 */
const AuthPreferences: React.FC = () => {
  const { t } = useTranslation();
  const { isDarkMode, toggleTheme } = useTheme();
  const label = isDarkMode ? t('web.topMenu.enableLightMode') : t('web.topMenu.enableDarkMode');

  return (
    <div className="flex items-center gap-1">
      <button type="button" id="auth-theme-toggle" onClick={toggleTheme} title={label} aria-label={label} className="p-2 rounded-md text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        <Icon name={isDarkMode ? 'sun' : 'moon'} className="w-5 h-5" />
      </button>
      <LanguageSwitcher />
    </div>
  );
};

export default AuthPreferences;
