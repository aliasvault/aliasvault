import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LanguageSwitcher from '@/entrypoints/popup/components/LanguageSwitcher';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { AppInfo } from '@/utils/AppInfo';
import { GLOBAL_AUTOFILL_POPUP_ENABLED_KEY, DISABLED_SITES_KEY, VAULT_LOCKED_DISMISS_UNTIL_KEY } from '@/utils/Constants';

import { storage } from '#imports';

/**
 * Auth settings page only shown when user is not logged in.
 */
const AuthSettings: React.FC = () => {
  const { t } = useTranslation();
  const [isGloballyEnabled, setIsGloballyEnabled] = useState<boolean>(true);
  const { setIsInitialLoading } = useLoading();

  useEffect(() => {
    /**
     * Load the stored settings from the storage.
     */
    const loadStoredSettings = async () : Promise<void> => {
      const globallyEnabled = await storage.getItem(GLOBAL_AUTOFILL_POPUP_ENABLED_KEY) !== false; // Default to true if not set
      const dismissUntil = await storage.getItem(VAULT_LOCKED_DISMISS_UNTIL_KEY) as number;

      if (dismissUntil) {
        setIsGloballyEnabled(false);
      } else {
        setIsGloballyEnabled(globallyEnabled);
      }

      setIsInitialLoading(false);
    };

    loadStoredSettings();
  }, [setIsInitialLoading]);

  /**
   * Toggle global popup.
   */
  const toggleGlobalPopup = async () : Promise<void> => {
    const newGloballyEnabled = !isGloballyEnabled;

    await storage.setItem(GLOBAL_AUTOFILL_POPUP_ENABLED_KEY, newGloballyEnabled);

    if (newGloballyEnabled) {
      // Reset all disabled sites when enabling globally
      await storage.setItem(DISABLED_SITES_KEY, []);
      await storage.setItem(VAULT_LOCKED_DISMISS_UNTIL_KEY, 0);
    }

    setIsGloballyEnabled(newGloballyEnabled);
  };

  return (
    <div className="p-4 space-y-6">
      {/* Autofill Settings Section */}
      <div className="space-y-4 pb-6 border-b border-gray-200 dark:border-gray-700">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            {t('settings.autofillSettings', 'Autofill Settings')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('settings.autofillSettingsDescription', 'Enable or disable the autofill popup on web pages')}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{t('settings.autofillEnabled')}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isGloballyEnabled
                ? t('settings.autofillEnabledDescription', 'Autofill suggestions will appear on login forms')
                : t('settings.autofillDisabledDescription', 'Autofill suggestions are disabled globally')
              }
            </p>
          </div>
          <button
            onClick={toggleGlobalPopup}
            className={`px-4 py-2 rounded-md transition-colors font-medium text-sm ${
              isGloballyEnabled
                ? 'bg-green-200 text-green-800 hover:bg-green-300 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50'
                : 'bg-red-200 text-red-800 hover:bg-red-300 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
            }`}
          >
            {isGloballyEnabled ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled')}
          </button>
        </div>
      </div>

      {/* Language Settings Section */}
      <div className="space-y-4 pb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
            {t('settings.languageSettings', 'Language')}
          </h2>
        </div>

        <div>
          <LanguageSwitcher variant="dropdown" size="sm" />
        </div>
      </div>

      {/* Version Info */}
      <div className="text-center text-xs text-gray-400 dark:text-gray-600 pt-4 border-t border-gray-200 dark:border-gray-700">
        {t('settings.version')}: {AppInfo.VERSION}
      </div>
    </div>
  );
};

export default AuthSettings;
