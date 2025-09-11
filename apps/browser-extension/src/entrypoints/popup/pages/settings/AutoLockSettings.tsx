import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import HelpModal from '@/entrypoints/popup/components/HelpModal';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { AUTO_LOCK_TIMEOUT_KEY } from '@/utils/Constants';

import { storage } from "#imports";

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
      const autoLockTimeoutValue = await storage.getItem(AUTO_LOCK_TIMEOUT_KEY) as number ?? 0;
      setAutoLockTimeout(autoLockTimeoutValue);
      setIsInitialLoading(false);
    };

    loadSettings();
  }, [setIsInitialLoading]);

  /**
   * Set auto-lock timeout.
   */
  const setAutoLockTimeoutSetting = async (timeout: number) : Promise<void> => {
    await storage.setItem(AUTO_LOCK_TIMEOUT_KEY, timeout);
    await sendMessage('SET_AUTO_LOCK_TIMEOUT', timeout, 'background');
    setAutoLockTimeout(timeout);
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.autoLockTimeout')}</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div>
              <div className="flex items-center mb-2">
                <p className="font-medium text-gray-900 dark:text-white">{t('settings.autoLockTimeout')}</p>
                <HelpModal
                  titleKey="settings.autoLockTimeout"
                  contentKey="settings.autoLockTimeoutHelp"
                  className="ml-2"
                />
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('settings.autoLockTimeoutDescription')}</p>
              <select
                value={autoLockTimeout}
                onChange={(e) => setAutoLockTimeoutSetting(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="0">{t('settings.autoLockNever')}</option>
                <option value="15">{t('settings.autoLock15Seconds')}</option>
                <option value="60">{t('settings.autoLock1Minute')}</option>
                <option value="300">{t('settings.autoLock5Minutes')}</option>
                <option value="900">{t('settings.autoLock15Minutes')}</option>
                <option value="1800">{t('settings.autoLock30Minutes')}</option>
                <option value="3600">{t('settings.autoLock1Hour')}</option>
                <option value="14400">{t('settings.autoLock4Hours')}</option>
                <option value="28800">{t('settings.autoLock8Hours')}</option>
                <option value="86400">{t('settings.autoLock24Hours')}</option>
              </select>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AutoLockSettings;