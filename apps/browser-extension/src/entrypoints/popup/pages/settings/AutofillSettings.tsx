import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { AutofillMatchingMode, LocalPreferencesService } from '@/utils/LocalPreferencesService';

import { browser } from "#imports";

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
 * Login save settings type.
 */
type LoginSaveSettingsType = {
  isEnabled: boolean;
  blockedDomains: string[];
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
  const [loginSaveSettings, setLoginSaveSettings] = useState<LoginSaveSettingsType>({
    isEnabled: false,
    blockedDomains: []
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
    const currentUrl = new URL(tab.url ?? '').hostname;

    // Load settings using LocalPreferencesService
    const disabledUrls = await LocalPreferencesService.getDisabledSites();
    const temporaryDisabledUrls = await LocalPreferencesService.getTemporaryDisabledSites();
    const isGloballyEnabled = await LocalPreferencesService.getGlobalAutofillPopupEnabled();

    // Clean up expired temporary disables
    const now = Date.now();
    const cleanedTemporaryDisabledUrls = Object.fromEntries(
      Object.entries(temporaryDisabledUrls).filter(([_, expiry]) => expiry > now)
    );

    if (Object.keys(cleanedTemporaryDisabledUrls).length !== Object.keys(temporaryDisabledUrls).length) {
      await LocalPreferencesService.setTemporaryDisabledSites(cleanedTemporaryDisabledUrls);
    }

    // Load autofill matching mode
    const matchingModeValue = await LocalPreferencesService.getAutofillMatchingMode();
    setAutofillMatchingMode(matchingModeValue);

    // Load login save settings
    const loginSaveEnabled = await LocalPreferencesService.getLoginSaveEnabled();
    const loginSaveBlockedDomains = await LocalPreferencesService.getLoginSaveBlockedDomains();
    setLoginSaveSettings({
      isEnabled: loginSaveEnabled,
      blockedDomains: loginSaveBlockedDomains
    });

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

    await LocalPreferencesService.setDisabledSites(newDisabledUrls);
    await LocalPreferencesService.setTemporaryDisabledSites(newTemporaryDisabledUrls);

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
    await LocalPreferencesService.setDisabledSites([]);
    await LocalPreferencesService.setTemporaryDisabledSites({});

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

    await LocalPreferencesService.setGlobalAutofillPopupEnabled(newGloballyEnabled);

    setSettings(prev => ({
      ...prev,
      isGloballyEnabled: newGloballyEnabled
    }));
  };

  /**
   * Set autofill matching mode.
   */
  const setAutofillMatchingModeSetting = async (mode: AutofillMatchingMode) : Promise<void> => {
    await LocalPreferencesService.setAutofillMatchingMode(mode);
    setAutofillMatchingMode(mode);
  };

  /**
   * Toggle login save feature.
   */
  const toggleLoginSave = async () : Promise<void> => {
    const newEnabled = !loginSaveSettings.isEnabled;
    await LocalPreferencesService.setLoginSaveEnabled(newEnabled);
    setLoginSaveSettings(prev => ({
      ...prev,
      isEnabled: newEnabled
    }));
  };

  /**
   * Remove a domain from the blocked list.
   */
  const removeBlockedDomain = async (domain: string) : Promise<void> => {
    const newBlockedDomains = loginSaveSettings.blockedDomains.filter(d => d !== domain);
    await LocalPreferencesService.setLoginSaveBlockedDomains(newBlockedDomains);
    setLoginSaveSettings(prev => ({
      ...prev,
      blockedDomains: newBlockedDomains
    }));
  };

  /**
   * Clear all blocked domains.
   */
  const clearAllBlockedDomains = async () : Promise<void> => {
    await LocalPreferencesService.setLoginSaveBlockedDomains([]);
    setLoginSaveSettings(prev => ({
      ...prev,
      blockedDomains: []
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
                {settings.isGloballyEnabled ? t('common.enabled') : t('common.disabled')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Login Save Settings Section */}
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.loginSave.title')}</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{t('settings.loginSave.title')}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('settings.loginSave.description')}</p>
              </div>
              <button
                onClick={toggleLoginSave}
                className={`px-4 py-2 rounded-md transition-colors ${
                  loginSaveSettings.isEnabled
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                {loginSaveSettings.isEnabled ? t('common.enabled') : t('common.disabled')}
              </button>
            </div>

            {/* Blocked domains list */}
            {loginSaveSettings.blockedDomains.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <p className="font-medium text-gray-900 dark:text-white mb-2">{t('settings.loginSave.blockedSites')}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{t('settings.loginSave.blockedSitesDescription')}</p>
                <ul className="space-y-2">
                  {loginSaveSettings.blockedDomains.map((domain) => (
                    <li key={domain} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-md px-3 py-2">
                      <span className="text-sm text-gray-900 dark:text-white truncate">{domain}</span>
                      <button
                        onClick={() => removeBlockedDomain(domain)}
                        className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 ml-2"
                      >
                        {t('settings.loginSave.removeBlockedSite')}
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={clearAllBlockedDomains}
                  className="w-full mt-3 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md text-gray-700 dark:text-gray-300 transition-colors text-sm"
                >
                  {t('settings.loginSave.clearAllBlockedSites')}
                </button>
              </div>
            )}
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
