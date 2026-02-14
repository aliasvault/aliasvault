import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { AutofillMatchingMode, LocalPreferencesService } from '@/utils/LocalPreferencesService';

/**
 * Autofill settings type.
 */
type AutofillSettingsType = {
  disabledUrls: string[];
  temporaryDisabledUrls: Record<string, number>;
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
    isGloballyEnabled: true
  });
  const [autofillMatchingMode, setAutofillMatchingMode] = useState<AutofillMatchingMode>(AutofillMatchingMode.DEFAULT);
  const [loginSaveSettings, setLoginSaveSettings] = useState<LoginSaveSettingsType>({
    isEnabled: false,
    blockedDomains: []
  });
  const [showDisabledSites, setShowDisabledSites] = useState(false);
  const [showBlockedDomains, setShowBlockedDomains] = useState(false);

  /**
   * Load settings.
   */
  const loadSettings = useCallback(async () : Promise<void> => {
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
      isGloballyEnabled
    });
    setIsInitialLoading(false);
  }, [setIsInitialLoading]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  /**
   * Reset settings.
   */
  const resetSettings = async () : Promise<void> => {
    await LocalPreferencesService.setDisabledSites([]);
    await LocalPreferencesService.setTemporaryDisabledSites({});

    setSettings(prev => ({
      ...prev,
      disabledUrls: [],
      temporaryDisabledUrls: {}
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

  /**
   * Remove a site from the disabled list (permanent or temporary).
   */
  const removeDisabledSite = async (site: string) : Promise<void> => {
    // Remove from permanent disabled list
    const newDisabledUrls = settings.disabledUrls.filter(url => url !== site);
    await LocalPreferencesService.setDisabledSites(newDisabledUrls);

    // Remove from temporary disabled list
    const newTemporaryDisabledUrls = { ...settings.temporaryDisabledUrls };
    delete newTemporaryDisabledUrls[site];
    await LocalPreferencesService.setTemporaryDisabledSites(newTemporaryDisabledUrls);

    setSettings(prev => ({
      ...prev,
      disabledUrls: newDisabledUrls,
      temporaryDisabledUrls: newTemporaryDisabledUrls
    }));
  };

  /**
   * Get total count of disabled sites (permanent + temporary).
   */
  const getDisabledSitesCount = () : number => {
    const permanentCount = settings.disabledUrls.length;
    const temporaryCount = Object.keys(settings.temporaryDisabledUrls).length;
    return permanentCount + temporaryCount;
  };

  return (
    <div className="space-y-6">
      {/* Autofill Popup Settings Section */}
      <section>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{t('settings.autofillPopup')}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 me-1">{t('settings.autofillPopupDescription')}</p>
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

            {/* Disabled sites list */}
            {getDisabledSitesCount() > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => setShowDisabledSites(!showDisabledSites)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <span className="font-medium text-gray-900 dark:text-white">
                    {t('settings.disabledSites')} ({getDisabledSitesCount()})
                  </span>
                  <svg
                    className={`w-5 h-5 text-gray-500 transition-transform ${showDisabledSites ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('settings.disabledSitesDescription')}</p>

                {showDisabledSites && (
                  <div className="mt-3">
                    <ul className="space-y-2">
                      {settings.disabledUrls.map((site) => (
                        <li key={site} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-md px-3 py-2">
                          <span className="text-sm text-gray-900 dark:text-white truncate">{site}</span>
                          <button
                            onClick={() => removeDisabledSite(site)}
                            className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 ml-2"
                          >
                            {t('common.remove')}
                          </button>
                        </li>
                      ))}
                      {Object.entries(settings.temporaryDisabledUrls).map(([site, expiry]) => (
                        <li key={site} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-md px-3 py-2">
                          <div className="truncate">
                            <span className="text-sm text-gray-900 dark:text-white">{site}</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                              ({t('settings.temporaryUntil')} {new Date(expiry).toLocaleTimeString()})
                            </span>
                          </div>
                          <button
                            onClick={() => removeDisabledSite(site)}
                            className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 ml-2"
                          >
                            {t('common.remove')}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={resetSettings}
                      className="w-full mt-3 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md text-gray-700 dark:text-gray-300 transition-colors text-sm"
                    >
                      {t('settings.clearAllDisabledSites')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Login Save Settings Section */}
      <section>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{t('settings.loginSave.title')}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 me-1">{t('settings.loginSave.description')}</p>
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
                <button
                  onClick={() => setShowBlockedDomains(!showBlockedDomains)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <span className="font-medium text-gray-900 dark:text-white">
                    {t('settings.loginSave.blockedSites')} ({loginSaveSettings.blockedDomains.length})
                  </span>
                  <svg
                    className={`w-5 h-5 text-gray-500 transition-transform ${showBlockedDomains ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('settings.loginSave.blockedSitesDescription')}</p>

                {showBlockedDomains && (
                  <div className="mt-3">
                    <ul className="space-y-2">
                      {loginSaveSettings.blockedDomains.map((domain) => (
                        <li key={domain} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-md px-3 py-2">
                          <span className="text-sm text-gray-900 dark:text-white truncate">{domain}</span>
                          <button
                            onClick={() => removeBlockedDomain(domain)}
                            className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 ml-2"
                          >
                            {t('common.remove')}
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
            )}
          </div>
        </div>
      </section>

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
