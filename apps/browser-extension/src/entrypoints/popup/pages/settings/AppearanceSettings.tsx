import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import PageTitle from '@/entrypoints/popup/components/PageTitle';
import ThemeSwitcher from '@/entrypoints/popup/components/ThemeSwitcher';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

/**
 * Appearance settings page component.
 */
const AppearanceSettings: React.FC = () => {
  const { t } = useTranslation();
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
              <ThemeSwitcher />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AppearanceSettings;
