import { AppInfo } from '@aliasvault/client/platform/AppInfo';
import { familySharingText } from '@aliasvault/client/sharing/FamilySharingView';
import { CapabilityKeys } from '@aliasvault/models/webapi';
import React, { useEffect, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import LogoutConfirmModal from '@/entrypoints/popup/components/Dialogs/LogoutConfirmModal';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { SettingsGroup, SettingsRow } from '@/entrypoints/popup/components/Settings/SettingsMenu';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useCapabilities } from '@/entrypoints/popup/context/CapabilityContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { useApiUrl } from '@/entrypoints/popup/utils/ApiUrlUtility';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import { StorageKeys } from '@/utils/constants/storageKeys';
import { logFailure } from '@/utils/Diagnostics';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

import { browser, storage } from "#imports";

/**
 * Settings page component.
 */
const Settings: React.FC = () => {
  const { t } = useTranslation();
  const app = useApp();
  const auth = useAuth();
  const hasCapability = useCapabilities();
  const webApi = useWebApi();
  const { setHeaderButtons } = useHeaderButtons();
  const { setIsInitialLoading } = useLoading();
  const { loadApiUrl, getDisplayUrl } = useApiUrl();
  const navigate = useNavigate();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  /**
   * Open the client tab.
   */
  const openClientTab = async () : Promise<void> => {
    const settingClientUrl = await storage.getItem(StorageKeys.CLIENT_URL) as string | undefined;
    let clientUrl = AppInfo.DEFAULT_CLIENT_URL;
    if (settingClientUrl && settingClientUrl.length > 0) {
      clientUrl = settingClientUrl;
    }

    window.open(clientUrl, '_blank');
  };

  // Set header buttons on mount and clear on unmount
  useEffect((): (() => void) => {
    const headerButtonsJSX = (
      <div className="flex items-center gap-2">
        {!PopoutUtility.isPopup() && (
          <>
            <HeaderButton
              onClick={() => PopoutUtility.openInNewPopup()}
              title={t('common.openInNewWindow')}
              iconType={HeaderIconType.EXPAND}
            />
          </>
        )}
        <HeaderButton
          onClick={openClientTab}
          title={t('settings.openWebApp')}
          iconType={HeaderIconType.EXTERNAL_LINK}
        />
      </div>
    );

    setHeaderButtons(headerButtonsJSX);
    return () => setHeaderButtons(null);
  }, [setHeaderButtons, t]);

  /**
   * Load settings.
   */
  const loadSettings = useCallback(async () : Promise<void> => {
    // Load API URL
    await loadApiUrl();

    /*
     * Load the last known server version (persisted on each status check) so it can be
     * shown next to the app version. Useful for self-hosted troubleshooting.
     */
    const storedServerVersion = await storage.getItem(StorageKeys.SERVER_VERSION) as string | undefined;
    setServerVersion(storedServerVersion ?? null);

    setIsInitialLoading(false);
  }, [setIsInitialLoading, loadApiUrl]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  /**
   * Opens the browser's keyboard shortcut settings page and closes the popup,
   * or null if the current browser has no such page (which hides the button).
   */
  const openKeyboardShortcuts = ((): (() => Promise<void>) | null => {
    if (import.meta.env.CHROME) {
      return async (): Promise<void> => {
        await browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
        window.close();
      };
    }

    if (import.meta.env.FIREFOX) {
      // Firefox 137+ only API, not present in the Chrome typings.
      const { openShortcutSettings } = browser.commands as { openShortcutSettings?: () => Promise<void> };
      if (openShortcutSettings) {
        return async (): Promise<void> => {
          await openShortcutSettings();
          window.close();
        };
      }
    }

    if (import.meta.env.SAFARI) {
      // The native SafariWebExtensionHandler opens Safari Settings → Extensions for this extension.
      return async (): Promise<void> => {
        await browser.runtime.sendNativeMessage('application.id', { action: 'openShortcutSettings' });
        window.close();
      };
    }

    return null;
  })();

  /**
   * Handle logout click - opens the logout confirmation modal.
   */
  const handleLogoutClick = () : void => {
    setShowLogoutConfirm(true);
  };

  /**
   * Handle logout (after confirmation).
   */
  const handleLogout = async () : Promise<void> => {
    setShowLogoutConfirm(false);

    try {
      await webApi.revokeTokens();
      await auth.clearAuthUserInitiated();
    } catch (error) {
      logFailure('Error during logout', error);
    }
  };

  /**
   * Handle lock vault.
   */
  const handleLock = async () : Promise<void> => {
    await sendMessage('LOCK_VAULT');

    // Navigate to unlock page
    navigate('/unlock');
  };

  return (
    <>
      {/* Logout Confirmation Modal */}
      <LogoutConfirmModal
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
      />

      <div className="space-y-6">
        <div className="flex justify-between items-center mb-4">
          <PageTitle>{t('common.settings')}</PageTitle>
        </div>

        {/* Account card: who is logged in, plus account-level destinations */}
        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden divide-y divide-gray-200 dark:divide-gray-700">
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
                      <span className="text-primary-600 dark:text-primary-400 text-lg font-medium">
                        {app.username?.[0]?.toUpperCase() || '?'}
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text font-medium text-gray-900 dark:text-white">
                      {app.username}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t('common.loggedIn')}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    id="lock-button"
                    onClick={handleLock}
                    title={t('settings.lock')}
                    className="p-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 rounded-md transition-colors"
                  >
                    <Icon name="lock-closed" className="w-5 h-5" aria-label={t('settings.lock')} />
                  </button>
                  <button
                    id="logout-button"
                    onClick={handleLogoutClick}
                    title={t('common.logout')}
                    className="p-2 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 rounded-md transition-colors"
                  >
                    <Icon name="logout" className="w-5 h-5" aria-label={t('common.logout')} />
                  </button>
                </div>
              </div>
            </div>
            {hasCapability(CapabilityKeys.VaultSharing) && (
              <SettingsRow
                label={familySharingText.title}
                badge={familySharingText.beta}
                onClick={() => navigate('/settings/family-sharing')}
                icon="user-group"
              />
            )}
          </div>
        </section>

        <SettingsGroup title={t('settings.autofill')}>
          <SettingsRow
            label={t('settings.autofillSettings')}
            onClick={() => navigate('/settings/autofill')}
            icon="document-text"
          />
          <SettingsRow
            label={t('settings.passkeySettings')}
            onClick={() => navigate('/settings/passkeys')}
            icon="key"
          />
          <SettingsRow
            label={t('settings.contextMenuSettings')}
            onClick={() => navigate('/settings/context-menu')}
            icon="menu-alt-3"
          />
          {openKeyboardShortcuts && (
            <SettingsRow
              label={t('settings.keyboardShortcuts')}
              onClick={openKeyboardShortcuts}
              external
              icon="keyboard"
            />
          )}
        </SettingsGroup>

        <SettingsGroup title={t('settings.security')}>
          <SettingsRow
            label={t('settings.vaultUnlock')}
            onClick={() => navigate('/settings/unlock-method')}
            icon="hashtag"
          />
          <SettingsRow
            label={t('settings.autoLock')}
            onClick={() => navigate('/settings/auto-lock')}
            icon="lock-closed"
          />
          <SettingsRow
            label={t('settings.clipboardClear')}
            onClick={() => navigate('/settings/clipboard')}
            icon="document-duplicate"
          />
          <SettingsRow
            id="security-settings-button"
            label={t('settings.accountSecurity')}
            onClick={() => navigate('/settings/security')}
            icon="shield-check"
          />
        </SettingsGroup>

        <SettingsGroup title={t('settings.groups.generators')}>
          <SettingsRow
            label={t('settings.passwordGenerator')}
            onClick={() => navigate('/settings/password-generator')}
            icon="key"
          />
          <SettingsRow
            label={t('settings.identityGenerator')}
            onClick={() => navigate('/settings/identity-generator')}
            icon="user"
          />
        </SettingsGroup>

        <SettingsGroup title={t('settings.groups.general')}>
          <SettingsRow
            label={t('settings.appearance')}
            onClick={() => navigate('/settings/appearance')}
            icon="color-swatch"
          />
          <SettingsRow
            label={t('settings.language')}
            onClick={() => navigate('/settings/language')}
            icon="translate"
          />
        </SettingsGroup>

        <div className="text-center text-[13px] text-gray-400 dark:text-gray-600">
          <div><span className="font-bold">{t('settings.appVersion')}:</span> {AppInfo.VERSION}</div>
          {serverVersion && (
            <div><span className="font-bold">{t('settings.serverVersion')}:</span> {serverVersion} ({getDisplayUrl()})</div>
          )}
        </div>
      </div>
    </>
  );
};

export default Settings;
