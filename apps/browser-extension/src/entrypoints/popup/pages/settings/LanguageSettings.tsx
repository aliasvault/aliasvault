import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LanguageSwitcher from '@/entrypoints/popup/components/LanguageSwitcher';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

/**
 * Language settings page component.
 */
const LanguageSettings: React.FC = () => {
  const { t } = useTranslation();
  const { setIsInitialLoading } = useLoading();

  useEffect(() => {
    // Mark initial loading as complete
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.language')}</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div>
              <p className="font-medium text-gray-900 dark:text-white mb-3">{t('settings.selectLanguage')}</p>
              <LanguageSwitcher variant="dropdown" size="sm" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default LanguageSettings;