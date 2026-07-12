import React, { useEffect, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import LogoutConfirmModal from '@/entrypoints/popup/components/Dialogs/LogoutConfirmModal';
import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import PageTitle from '@/entrypoints/popup/components/PageTitle';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useWebApi } from '@/entrypoints/popup/context/WebApiContext';
import { useApiUrl } from '@/entrypoints/popup/utils/ApiUrlUtility';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import { AppInfo } from '@/utils/AppInfo';
import { sendMessage } from '@/utils/messaging/ExtensionMessaging';

import { browser, storage } from "#imports";

/**
 * Settings page component.
 */
const Settings: React.FC = () => {
  const { t } = useTranslation();
  const app = useApp();
  const auth = useAuth();
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
    const settingClientUrl = await storage.getItem('local:clientUrl') as string | undefined;
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
    const storedServerVersion = await storage.getItem('local:serverVersion') as string | undefined;
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
      console.error('Error during logout:', error);
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

  /**
   * Navigate to autofill settings.
   */
  const navigateToAutofillSettings = () : void => {
    navigate('/settings/autofill');
  };

  /**
   * Navigate to clipboard settings.
   */
  const navigateToClipboardSettings = () : void => {
    navigate('/settings/clipboard');
  };

  /**
   * Navigate to language settings.
   */
  const navigateToLanguageSettings = () : void => {
    navigate('/settings/language');
  };

  /**
   * Navigate to auto-lock settings.
   */
  const navigateToAutoLockSettings = () : void => {
    navigate('/settings/auto-lock');
  };

  /**
   * Navigate to unlock method settings.
   */
  const navigateToUnlockMethodSettings = () : void => {
    navigate('/settings/unlock-method');
  };

  /**
   * Navigate to context menu settings.
   */
  const navigateToContextMenuSettings = () : void => {
    navigate('/settings/context-menu');
  };

  /**
   * Navigate to passkey settings.
   */
  const navigateToPasskeySettings = () : void => {
    navigate('/settings/passkeys');
  };

  /**
   * Navigate to identity generator settings.
   */
  const navigateToIdentityGeneratorSettings = () : void => {
    navigate('/settings/identity-generator');
  };

  /**
   * Navigate to password generator settings.
   */
  const navigateToPasswordGeneratorSettings = () : void => {
    navigate('/settings/password-generator');
  };

  /**
   * Navigate to appearance settings.
   */
  const navigateToAppearanceSettings = () : void => {
    navigate('/settings/appearance');
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

        {/* User Menu Section */}
        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
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
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                      aria-label={t('settings.lock')}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                      />
                    </svg>
                  </button>
                  <button
                    id="logout-button"
                    onClick={handleLogoutClick}
                    title={t('common.logout')}
                    className="p-2 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 rounded-md transition-colors"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                      aria-label={t('common.logout')}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Settings Navigation Section */}
        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {/* Autofill Settings */}
              <button
                onClick={navigateToAutofillSettings}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <span className="text-gray-900 dark:text-white text-left">{t('settings.autofillSettings')}</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Passkey Settings */}
              <button
                onClick={navigateToPasskeySettings}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                    />
                  </svg>
                  <span className="text-gray-900 dark:text-white text-left">{t('settings.passkeySettings')}</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Vault Unlock Method */}
              <button
                onClick={navigateToUnlockMethodSettings}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <svg className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round"  d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
                  </svg>
                  <span className="text-gray-900 dark:text-white text-left">{t('settings.unlockMethod.title')}</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Auto-lock Settings */}
              <button
                onClick={navigateToAutoLockSettings}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <span className="text-gray-900 dark:text-white text-left">{t('settings.autoLockTimeout')}</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Clipboard Settings */}
              <button
                onClick={navigateToClipboardSettings}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"
                    />
                  </svg>
                  <span className="text-gray-900 dark:text-white text-left">{t('settings.clipboardSettings')}</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Language Settings */}
              <button
                onClick={navigateToLanguageSettings}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
                    />
                  </svg>
                  <span className="text-gray-900 dark:text-white text-left">{t('settings.language')}</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        {/* Generator Settings Section */}
        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {/* Password Generator Settings */}
              <button
                onClick={navigateToPasswordGeneratorSettings}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                    />
                  </svg>
                  <span className="text-gray-900 dark:text-white text-left">{t('settings.passwordGenerator')}</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Identity Generator Settings */}
              <button
                onClick={navigateToIdentityGeneratorSettings}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  <span className="text-gray-900 dark:text-white text-left">{t('settings.identityGenerator')}</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Context Menu Settings */}
              <button
                onClick={navigateToContextMenuSettings}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 6h16M4 12h16m-7 6h7"
                    />
                  </svg>
                  <span className="text-gray-900 dark:text-white text-left">{t('settings.contextMenuSettings')}</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        {/* Appearance & Keyboard Shortcuts Section */}
        <section>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {/* Appearance Settings */}
              <button
                onClick={navigateToAppearanceSettings}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828L9.828 19.071M7 17h.01"
                    />
                  </svg>
                  <span className="text-gray-900 dark:text-white text-left">{t('settings.appearance')}</span>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Keyboard Shortcuts (opens browser settings) */}
              {openKeyboardShortcuts && (
                <button
                  onClick={openKeyboardShortcuts}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center">
                    <svg
                      className="w-5 h-5 mr-3 text-gray-600 dark:text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 7h14a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2zM7 11h.01M11 11h.01M15 11h.01M8 15h8"
                      />
                    </svg>
                    <span className="text-gray-900 dark:text-white text-left">{t('settings.keyboardShortcuts')}</span>
                  </div>
                  {/* External-link icon: indicates this opens the browser's own settings */}
                  <svg
                    className="w-4 h-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </section>

        <div className="text-center text-[13px] text-gray-400 dark:text-gray-600">
          <div><span className="font-bold">{t('settings.versionPrefix')}:</span> {AppInfo.VERSION}</div>
          {serverVersion && (
            <div><span className="font-bold">{t('settings.serverVersion')}:</span> {serverVersion} ({getDisplayUrl()})</div>
          )}
        </div>
      </div>
    </>
  );
};

export default Settings;