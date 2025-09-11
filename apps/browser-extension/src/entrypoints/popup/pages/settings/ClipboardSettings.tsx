import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sendMessage } from 'webext-bridge/popup';

import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { CLIPBOARD_CLEAR_TIMEOUT_KEY } from '@/utils/Constants';

import { storage } from "#imports";

/**
 * Clipboard settings page component.
 */
const ClipboardSettings: React.FC = () => {
  const { t } = useTranslation();
  const { setIsInitialLoading } = useLoading();
  const [clipboardTimeout, setClipboardTimeout] = useState<number>(10);

  useEffect(() => {
    /**
     * Load clipboard settings.
     */
    const loadSettings = async () : Promise<void> => {
      // Load clipboard clear timeout
      const timeout = await storage.getItem(CLIPBOARD_CLEAR_TIMEOUT_KEY) as number ?? 10;
      setClipboardTimeout(timeout);
      setIsInitialLoading(false);
    };

    loadSettings();
  }, [setIsInitialLoading]);

  /**
   * Set clipboard clear timeout.
   */
  const setClipboardClearTimeout = async (timeout: number) : Promise<void> => {
    await storage.setItem(CLIPBOARD_CLEAR_TIMEOUT_KEY, timeout);
    await sendMessage('SET_CLIPBOARD_CLEAR_TIMEOUT', timeout, 'background');
    setClipboardTimeout(timeout);
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.clipboardSettings')}</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div>
              <p className="font-medium text-gray-900 dark:text-white mb-2">{t('settings.clipboardClearTimeout')}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('settings.clipboardClearTimeoutDescription')}</p>
              <select
                value={clipboardTimeout}
                onChange={(e) => setClipboardClearTimeout(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="0">{t('settings.clipboardClearDisabled')}</option>
                <option value="5">{t('settings.clipboardClear5Seconds')}</option>
                <option value="10">{t('settings.clipboardClear10Seconds')}</option>
                <option value="15">{t('settings.clipboardClear15Seconds')}</option>
              </select>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ClipboardSettings;