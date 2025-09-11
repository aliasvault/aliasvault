import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { AutofillMatchingMode } from '@/entrypoints/contentScript/Filter';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { 
  DISABLED_SITES_KEY, 
  GLOBAL_AUTOFILL_POPUP_ENABLED_KEY, 
  TEMPORARY_DISABLED_SITES_KEY,
  AUTOFILL_MATCHING_MODE_KEY 
} from '@/utils/Constants';

import { storage, browser } from "#imports";

/**
 * Autofill settings type.
 */
type AutofillSettingsType = {
  disabledUrls: string[];
  temporaryDisabledUrls: Record<string, number>;
  currentUrl: string;
  isEnabled: boolean;
  isGloballyEnabled: boolean;
}

/**
 * Autofill settings page component.
 */
const AutofillSettings: React.FC = () => {
  const { t } = useTranslation();
  const { setIsInitialLoading } = useLoading();
  const [settings, setSettings] = useState<AutofillSettingsType>({
    disabledUrls: [],
    temporaryDisabledUrls: {},
    currentUrl: '',
    isEnabled: true,
    isGloballyEnabled: true
  });
  const [autofillMatchingMode, setAutofillMatchingMode] = useState<AutofillMatchingMode>(AutofillMatchingMode.DEFAULT);

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
    const currentUrl = new URL(tab.url ?? '').hostname;

    // Load settings local storage.
    const disabledUrls = await storage.getItem(DISABLED_SITES_KEY) as string[] ?? [];
    const temporaryDisabledUrls = await storage.getItem(TEMPORARY_DISABLED_SITES_KEY) as Record<string, number> ?? {};
    const isGloballyEnabled = await storage.getItem(GLOBAL_AUTOFILL_POPUP_ENABLED_KEY) !== false; // Default to true if not set

    // Clean up expired temporary disables
    const now = Date.now();
    const cleanedTemporaryDisabledUrls = Object.fromEntries(
      Object.entries(temporaryDisabledUrls).filter(([_, expiry]) => expiry > now)
    );

    if (Object.keys(cleanedTemporaryDisabledUrls).length !== Object.keys(temporaryDisabledUrls).length) {
      await storage.setItem(TEMPORARY_DISABLED_SITES_KEY, cleanedTemporaryDisabledUrls);
    }

    // Load autofill matching mode
    const matchingModeValue = await storage.getItem(AUTOFILL_MATCHING_MODE_KEY) as AutofillMatchingMode ?? AutofillMatchingMode.DEFAULT;
    setAutofillMatchingMode(matchingModeValue);

    setSettings({
      disabledUrls,
      temporaryDisabledUrls: cleanedTemporaryDisabledUrls,
      currentUrl,
      isEnabled: !disabledUrls.includes(currentUrl) && !(currentUrl in cleanedTemporaryDisabledUrls),
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
    const { currentUrl, disabledUrls, temporaryDisabledUrls, isEnabled } = settings;

    let newDisabledUrls = [...disabledUrls];
    let newTemporaryDisabledUrls = { ...temporaryDisabledUrls };

    if (isEnabled) {
      // When disabling, add to permanent disabled list
      if (!newDisabledUrls.includes(currentUrl)) {
        newDisabledUrls.push(currentUrl);
      }
      // Also remove from temporary disabled list if present
      delete newTemporaryDisabledUrls[currentUrl];
    } else {
      // When enabling, remove from both permanent and temporary disabled lists
      newDisabledUrls = newDisabledUrls.filter(url => url !== currentUrl);
      delete newTemporaryDisabledUrls[currentUrl];
    }

    await storage.setItem(DISABLED_SITES_KEY, newDisabledUrls);
    await storage.setItem(TEMPORARY_DISABLED_SITES_KEY, newTemporaryDisabledUrls);

    setSettings(prev => ({
      ...prev,
      disabledUrls: newDisabledUrls,
      temporaryDisabledUrls: newTemporaryDisabledUrls,
      isEnabled: !isEnabled
    }));
  };

  /**
   * Reset settings.
   */
  const resetSettings = async () : Promise<void> => {
    await storage.setItem(DISABLED_SITES_KEY, []);
    await storage.setItem(TEMPORARY_DISABLED_SITES_KEY, {});

    setSettings(prev => ({
      ...prev,
      disabledUrls: [],
      temporaryDisabledUrls: {},
      isEnabled: true
    }));
  };

  /**
   * Toggle global popup.
   */
  const toggleGlobalPopup = async () : Promise<void> => {
    const newGloballyEnabled = !settings.isGloballyEnabled;

    await storage.setItem(GLOBAL_AUTOFILL_POPUP_ENABLED_KEY, newGloballyEnabled);

    setSettings(prev => ({
      ...prev,
      isGloballyEnabled: newGloballyEnabled
    }));
  };

  /**
   * Set autofill matching mode.
   */
  const setAutofillMatchingModeSetting = async (mode: AutofillMatchingMode) : Promise<void> => {
    await storage.setItem(AUTOFILL_MATCHING_MODE_KEY, mode);
    setAutofillMatchingMode(mode);
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
                <p className="font-medium text-gray-900 dark:text-white">{t('settings.autofillPopup')}</p>
                <p className={`text-sm mt-1 ${settings.isGloballyEnabled ? 'text-gray-600 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}>
                  {settings.isGloballyEnabled ? t('settings.activeOnAllSites') : t('settings.disabledOnAllSites')}
                </p>
              </div>
              <button
                onClick={toggleGlobalPopup}
                className={`px-4 py-2 rounded-md transition-colors ${
                  settings.isGloballyEnabled
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                {settings.isGloballyEnabled ? t('settings.enabled') : t('settings.disabled')}
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
                  <p className="font-medium text-gray-900 dark:text-white">{t('settings.autofillPopupOn')}{settings.currentUrl}</p>
                  <p className={`text-sm mt-1 ${settings.isEnabled ? 'text-gray-600 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}>
                    {settings.isEnabled ? t('settings.enabledForThisSite') : t('settings.disabledForThisSite')}
                  </p>
                  {!settings.isEnabled && settings.temporaryDisabledUrls[settings.currentUrl] && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {t('settings.temporarilyDisabledUntil')}{new Date(settings.temporaryDisabledUrls[settings.currentUrl]).toLocaleTimeString()}
                    </p>
                  )}
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
                    {settings.isEnabled ? t('settings.enabled') : t('settings.disabled')}
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

      {/* Autofill Matching Settings Section */}
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.autofillMatching')}</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div>
              <p className="font-medium text-gray-900 dark:text-white mb-2">{t('settings.autofillMatchingMode')}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('settings.autofillMatchingModeDescription')}</p>
              <select
                value={autofillMatchingMode}
                onChange={(e) => setAutofillMatchingModeSetting(e.target.value as AutofillMatchingMode)}
                className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-primary-500 focus:border-primary-500"
              >
                <option value={AutofillMatchingMode.DEFAULT}>{t('settings.autofillMatchingDefault')}</option>
                <option value={AutofillMatchingMode.URL_SUBDOMAIN}>{t('settings.autofillMatchingUrlSubdomain')}</option>
                <option value={AutofillMatchingMode.URL_EXACT}>{t('settings.autofillMatchingUrlExact')}</option>
              </select>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AutofillSettings;