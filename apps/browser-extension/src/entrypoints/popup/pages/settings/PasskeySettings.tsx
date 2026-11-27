import { extractDomain } from '@aliasvault/client/rust/RustCore';
import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { SettingsGroup, SettingsToggleRow } from '@/entrypoints/popup/components/Settings/SettingsMenu';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

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
    const url = tab.url ?? '';
    const domain = await extractDomain(url);

    // Load settings using LocalPreferencesService
    const disabledUrls = await LocalPreferencesService.getPasskeyDisabledSites();
    const isGloballyEnabled = await LocalPreferencesService.getPasskeyProviderEnabled();

    // Check if current domain is disabled
    const isEnabled = !disabledUrls.includes(domain);

    setSettings({
      disabledUrls,
      currentUrl: domain,
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
      <PageTitle>{t('settings.passkeySettings')}</PageTitle>
      {/* Global Settings Section */}
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.globalSettings')}</h3>
        <SettingsGroup>
          <SettingsToggleRow label={t('passkeys.settings.passkeyProvider')} checked={settings.isGloballyEnabled} onChange={toggleGlobalPasskeyProvider} />
        </SettingsGroup>
      </section>

      {/* Site-Specific Settings Section */}
      {settings.isGloballyEnabled && (
        <section>
          <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.siteSpecificSettings')}</h3>
          <SettingsGroup>
            {settings.currentUrl && <SettingsToggleRow label={settings.currentUrl} checked={settings.isEnabled} onChange={toggleCurrentSite} />}
            <button
              onClick={resetSettings}
              className="w-full px-4 py-3 text-sm text-center text-primary-600 dark:text-primary-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('settings.resetAllSiteSettings')}
            </button>
          </SettingsGroup>
        </section>
      )}
    </div>
  );
};

export default PasskeySettings;
