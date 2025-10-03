import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { PASSKEY_PROVIDER_ENABLED_KEY } from '@/utils/Constants';

import { storage } from "#imports";

/**
 * Passkey settings page component.
 */
const PasskeySettings: React.FC = () => {
  const { t } = useTranslation();
  const { setIsInitialLoading } = useLoading();
  const [passkeyProviderEnabled, setPasskeyProviderEnabled] = useState<boolean>(true);

  useEffect(() => {
    /**
     * Load passkey settings.
     */
    const loadSettings = async () : Promise<void> => {
      // Load passkey provider enabled setting (default to true if not set)
      const enabled = await storage.getItem(PASSKEY_PROVIDER_ENABLED_KEY);
      setPasskeyProviderEnabled(enabled !== false);
      setIsInitialLoading(false);
    };

    loadSettings();
  }, [setIsInitialLoading]);

  /**
   * Toggle passkey provider enabled setting.
   */
  const togglePasskeyProvider = async () : Promise<void> => {
    const newEnabled = !passkeyProviderEnabled;

    // Update UI state immediately for responsive feedback
    setPasskeyProviderEnabled(newEnabled);

    // Persist to storage
    await storage.setItem(PASSKEY_PROVIDER_ENABLED_KEY, newEnabled);
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.passkeySettings')}</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{t('passkeys.settings.passkeyProvider')}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  {t('passkeys.settings.description')}
                </p>
              </div>
              <button
                onClick={togglePasskeyProvider}
                className={`px-4 ml-4 py-2 rounded-md transition-colors ${
                  passkeyProviderEnabled
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                {passkeyProviderEnabled ? t('settings.enabled') : t('settings.disabled')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default PasskeySettings;
