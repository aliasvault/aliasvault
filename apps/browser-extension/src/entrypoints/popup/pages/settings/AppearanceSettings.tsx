import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useTheme } from '@/entrypoints/popup/context/ThemeContext';

/**
 * Appearance settings page component.
 */
const AppearanceSettings: React.FC = () => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { setIsInitialLoading } = useLoading();

  useEffect(() => {
    // Mark initial loading as complete
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  return (
    <div className="space-y-6">
      <PageTitle>{t('settings.appearance')}</PageTitle>
      <section>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div>
              <p className="font-medium text-gray-900 dark:text-white mb-2">{t('settings.theme')}</p>
              <div className="flex flex-col space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="theme"
                    value="system"
                    checked={theme === 'system'}
                    onChange={() => setTheme('system')}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{t('settings.useDefault')}</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="theme"
                    value="light"
                    checked={theme === 'light'}
                    onChange={() => setTheme('light')}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{t('settings.light')}</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="theme"
                    value="dark"
                    checked={theme === 'dark'}
                    onChange={() => setTheme('dark')}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{t('settings.dark')}</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AppearanceSettings;
