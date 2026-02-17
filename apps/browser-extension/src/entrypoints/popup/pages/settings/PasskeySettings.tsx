import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { extractDomain, extractRootDomain } from '@/utils/itemMatcher/ItemMatcher';
import { LocalPreferencesService } from '@/utils/LocalPreferencesService';

import { browser } from "#imports";

/**
 * Passkey settings type.
 */
type PasskeySettingsType = {
  disabledUrls: string[];
  currentUrl: string;
  isEnabled: boolean;
  isGloballyEnabled: boolean;
}

/**
 * Passkey settings page component.
 */
const PasskeySettings: React.FC = () => {
  const { t } = useTranslation();
  const { setIsInitialLoading } = useLoading();
  const [settings, setSettings] = useState<PasskeySettingsType>({
    disabledUrls: [],
    currentUrl: '',
    isEnabled: true,
    isGloballyEnabled: true
  });

  /**
   * Get current tab in browser.
   */
  const getCurrentTab = async () : Promise<chrome.tabs.Tab> => {
    const queryOptions = { active: true, currentWindow: true };
    const [tab] = await browser.tabs.query(queryOptions);
    return tab;
  };

  /**
   * Load settings.
   */
  const loadSettings = useCallback(async () : Promise<void> => {
    const tab = await getCurrentTab();
    const hostname = new URL(tab.url ?? '').hostname;
    const baseDomain = await extractRootDomain(await extractDomain(hostname));

    // Load settings using LocalPreferencesService
    const disabledUrls = await LocalPreferencesService.getPasskeyDisabledSites();
    const isGloballyEnabled = await LocalPreferencesService.getPasskeyProviderEnabled();

    // Check if current base domain is disabled
    const isEnabled = !disabledUrls.includes(baseDomain);

    setSettings({
      disabledUrls,
      currentUrl: baseDomain,
      isEnabled,
      isGloballyEnabled
    });
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  /**
   * Toggle current site.
   */
  const toggleCurrentSite = async () : Promise<void> => {
    const { currentUrl, disabledUrls, isEnabled } = settings;

    let newDisabledUrls = [...disabledUrls];

    if (isEnabled) {
      // When disabling, add to permanent disabled list
      if (!newDisabledUrls.includes(currentUrl)) {
        newDisabledUrls.push(currentUrl);
      }
    } else {
      // When enabling, remove from disabled list
      newDisabledUrls = newDisabledUrls.filter(url => url !== currentUrl);
    }

    await LocalPreferencesService.setPasskeyDisabledSites(newDisabledUrls);

    setSettings(prev => ({
      ...prev,
      disabledUrls: newDisabledUrls,
      isEnabled: !isEnabled
    }));
  };

  /**
   * Reset settings.
   */
  const resetSettings = async () : Promise<void> => {
    await LocalPreferencesService.setPasskeyDisabledSites([]);

    setSettings(prev => ({
      ...prev,
      disabledUrls: [],
      isEnabled: true
    }));
  };

  /**
   * Toggle global passkey provider.
   */
  const toggleGlobalPasskeyProvider = async () : Promise<void> => {
    const newGloballyEnabled = !settings.isGloballyEnabled;

    await LocalPreferencesService.setPasskeyProviderEnabled(newGloballyEnabled);

    setSettings(prev => ({
      ...prev,
      isGloballyEnabled: newGloballyEnabled
    }));
  };

  return (
    <div className="space-y-6">
      {/* Global Settings Section */}
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.globalSettings')}</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{t('passkeys.settings.passkeyProvider')}</p>
                <p className={`text-sm mt-1 ${settings.isGloballyEnabled ? 'text-gray-600 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}>
                  {settings.isGloballyEnabled ? t('settings.activeOnAllSites') : t('settings.disabledOnAllSites')}
                </p>
              </div>
              <button
                onClick={toggleGlobalPasskeyProvider}
                className={`px-4 py-2 rounded-md transition-colors ${
                  settings.isGloballyEnabled
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                {settings.isGloballyEnabled ? t('common.enabled') : t('common.disabled')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Site-Specific Settings Section */}
      {settings.isGloballyEnabled && (
        <section>
          <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.siteSpecificSettings')}</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{t('passkeys.settings.passkeyProviderOn')}{settings.currentUrl}</p>
                  <p className={`text-sm mt-1 ${settings.isEnabled ? 'text-gray-600 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}>
                    {settings.isEnabled ? t('settings.enabledForThisSite') : t('settings.disabledForThisSite')}
                  </p>
                </div>
                {settings.isGloballyEnabled && (
                  <button
                    onClick={toggleCurrentSite}
                    className={`px-4 py-2 ml-1 rounded-md transition-colors ${
                      settings.isEnabled
                        ? 'bg-green-500 hover:bg-green-600 text-white'
                        : 'bg-red-500 hover:bg-red-600 text-white'
                    }`}
                  >
                    {settings.isEnabled ? t('common.enabled') : t('common.disabled')}
                  </button>
                )}
              </div>

              <div className="mt-4">
                <button
                  onClick={resetSettings}
                  className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md text-gray-700 dark:text-gray-300 transition-colors text-sm"
                >
                  {t('settings.resetAllSiteSettings')}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default PasskeySettings;
