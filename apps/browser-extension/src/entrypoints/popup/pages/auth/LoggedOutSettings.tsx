import { AppInfo } from '@aliasvault/client/platform/AppInfo';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LanguageSwitcher from '@/entrypoints/popup/components/LanguageSwitcher';
import { SettingsGroup, SettingsToggleRow } from '@/entrypoints/popup/components/Settings/SettingsMenu';
import ThemeSwitcher from '@/entrypoints/popup/components/ThemeSwitcher';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';

import { LocalPreferencesService } from '@/utils/LocalPreferencesService';

/**
 * Settings page shown when the user is not logged in.
 */
const LoggedOutSettings: React.FC = () => {
  const { t } = useTranslation();
  const [isGloballyEnabled, setIsGloballyEnabled] = useState<boolean>(true);
  const [isPasskeyProviderEnabled, setIsPasskeyProviderEnabled] = useState<boolean>(true);
  const { setIsInitialLoading } = useLoading();

  useEffect(() => {
    /**
     * Load the stored settings from the storage.
     */
    const loadStoredSettings = async () : Promise<void> => {
      const globallyEnabled = await LocalPreferencesService.getGlobalAutofillPopupEnabled();
      const dismissUntil = await LocalPreferencesService.getVaultLockedDismissUntil();
      const passkeyDismissed = Date.now() < await LocalPreferencesService.getPasskeyLockedDismissUntil();
      setIsPasskeyProviderEnabled(!passkeyDismissed && await LocalPreferencesService.getPasskeyProviderEnabled());

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

    await LocalPreferencesService.setGlobalAutofillPopupEnabled(newGloballyEnabled);

    if (newGloballyEnabled) {
      // Reset all disabled sites when enabling globally
      await LocalPreferencesService.setDisabledSites([]);
      await LocalPreferencesService.setVaultLockedDismissUntil(0);
    }

    setIsGloballyEnabled(newGloballyEnabled);
  };

  /**
   * Toggle the passkey provider on all sites.
   */
  const togglePasskeyProvider = async () : Promise<void> => {
    const newEnabled = !isPasskeyProviderEnabled;
    await LocalPreferencesService.setPasskeyProviderEnabled(newEnabled);

    if (newEnabled) {
      await LocalPreferencesService.setPasskeyLockedDismissUntil(0);
    }

    setIsPasskeyProviderEnabled(newEnabled);
  };

  return (
    <div id="logged-out-settings" className="space-y-6">
      <SettingsGroup title={t('settings.autofill')}>
        <SettingsToggleRow id="autofill-toggle" label={t('settings.groups.autofill')} checked={isGloballyEnabled} onChange={toggleGlobalPopup} />
        <SettingsToggleRow id="passkeys-toggle" label={t('common.passkeys')} checked={isPasskeyProviderEnabled} onChange={togglePasskeyProvider} />
      </SettingsGroup>

      <SettingsGroup title={t('settings.language')}>
        <div className="p-3">
          <LanguageSwitcher />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('settings.theme')}>
        <div className="p-3">
          <ThemeSwitcher />
        </div>
      </SettingsGroup>

      <p className="text-center text-xs text-gray-400 dark:text-gray-500">
        {t('settings.version')}: {AppInfo.VERSION}
      </p>
    </div>
  );
};

export default LoggedOutSettings;
