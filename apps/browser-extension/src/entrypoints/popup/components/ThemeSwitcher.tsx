import React from 'react';
import { useTranslation } from 'react-i18next';

import { useTheme, type Theme } from '@/entrypoints/popup/context/ThemeContext';

/**
 * Theme selector (system, light or dark) as a group of radio buttons.
 */
const ThemeSwitcher: React.FC = (): React.JSX.Element => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const options: { value: Theme; label: string }[] = [
    { value: 'system', label: t('settings.useDefault') },
    { value: 'light', label: t('settings.light') },
    { value: 'dark', label: t('settings.dark') },
  ];

  return (
    <div className="flex flex-col space-y-2">
      {options.map(option => (
        <label key={option.value} className="flex items-center">
          <input type="radio" name="theme" value={option.value} checked={theme === option.value} onChange={() => setTheme(option.value)} className="mr-2" />
          <span className="text-sm text-gray-700 dark:text-gray-300">{option.label}</span>
        </label>
      ))}
    </div>
  );
};

export default ThemeSwitcher;
