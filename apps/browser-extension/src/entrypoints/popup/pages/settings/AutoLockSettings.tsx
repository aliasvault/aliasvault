import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import HelpModal from '@/entrypoints/popup/components/Dialogs/HelpModal';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

/**
 * Auto-lock settings page component.
 */
const AutoLockSettings: React.FC = () => {
  const { t } = useTranslation();
  const { setIsInitialLoading } = useLoading();
  const [autoLockTimeout, setAutoLockTimeout] = useState<number>(0);

  useEffect(() => {
    /**
     * Load auto-lock settings.
     */
    const loadSettings = async () : Promise<void> => {
      // Load auto-lock timeout
      const autoLockTimeoutValue = await LocalPreferencesService.getAutoLockTimeout();
      setAutoLockTimeout(autoLockTimeoutValue);
      setIsInitialLoading(false);
    };

    loadSettings();
  }, [setIsInitialLoading]);

  /**
   * Set auto-lock timeout.
   */
  const setAutoLockTimeoutSetting = async (timeout: number) : Promise<void> => {
    setAutoLockTimeout(timeout);
    await LocalPreferencesService.setAutoLockTimeout(timeout);
    await sendMessage('SET_AUTO_LOCK_TIMEOUT', timeout);
  };

  return (
    <div className="space-y-6">
      <PageTitle>{t('settings.autoLock')}</PageTitle>
      <section>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div>
              <div className="flex items-center mb-2">
                <p className="font-medium text-gray-900 dark:text-white">{t('settings.autoLock')}</p>
                <HelpModal
                  title={t('settings.autoLock')}
                  content={t('settings.autoLockTimeoutHelp')}
                  className="ml-2"
                />
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('settings.autoLockTimeoutDescription')}</p>
              <select
                value={autoLockTimeout}
                onChange={(e) => setAutoLockTimeoutSetting(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="0">{t('common.never')}</option>
                <option value="15">{t('common.duration.15seconds')}</option>
                <option value="30">{t('common.duration.30seconds')}</option>
                <option value="60">{t('settings.autoLockOptions.1minute')}</option>
                <option value="300">{t('settings.autoLockOptions.5minutes')}</option>
                <option value="900">{t('settings.autoLockOptions.15minutes')}</option>
                <option value="1800">{t('settings.autoLockOptions.30minutes')}</option>
                <option value="3600">{t('settings.autoLockOptions.1hour')}</option>
                <option value="14400">{t('settings.autoLockOptions.4hours')}</option>
                <option value="28800">{t('settings.autoLockOptions.8hours')}</option>
                <option value="86400">{t('settings.autoLockOptions.24hours')}</option>
              </select>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AutoLockSettings;
