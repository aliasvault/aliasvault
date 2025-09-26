import React, { useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useLoading } from '@/entrypoints/popup/context/LoadingContext';
import { useTheme } from '@/entrypoints/popup/context/ThemeContext';
import { useApiUrl } from '@/entrypoints/popup/utils/ApiUrlUtility';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import { AppInfo } from '@/utils/AppInfo';

import { browser } from "#imports";

/**
 * Settings page component.
 */
const Settings: React.FC = () => {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const app = useApp();
  const { setHeaderButtons } = useHeaderButtons();
  const { setIsInitialLoading } = useLoading();
  const { loadApiUrl, getDisplayUrl } = useApiUrl();
  const navigate = useNavigate();

  /**
   * Open the client tab.
   */
  const openClientTab = async () : Promise<void> => {
    const settingClientUrl = await browser.storage.local.get('clientUrl');
    let clientUrl = AppInfo.DEFAULT_CLIENT_URL;
    if (settingClientUrl?.clientUrl && settingClientUrl.clientUrl.length > 0) {
      clientUrl = settingClientUrl.clientUrl;
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
              title={t('settings.openInNewWindow')}
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
    setIsInitialLoading(false);
  }, [setIsInitialLoading, loadApiUrl]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  /**
   * Set theme preference.
   */
  const setThemePreference = async (newTheme: 'system' | 'light' | 'dark') : Promise<void> => {
    // Use the ThemeContext to apply the theme
    setTheme(newTheme);
  };

  /**
   * Open keyboard shortcuts configuration page.
   */
  const openKeyboardShortcuts = async (): Promise<void> => {
    // Detect browser type using user agent
    const userAgent = navigator.userAgent.toLowerCase();
    const isFirefox = userAgent.includes('firefox');
    const isSafari = userAgent.includes('safari') && !userAgent.includes('chrome');

    if (isFirefox) {
      await browser.tabs.create({ url: 'about:addons' });
    } else if (isSafari) {
      await browser.tabs.create({ url: 'safari-extension://shortcuts' });
    } else {
      // Chrome and other Chromium-based browsers
      await browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
    }
  };

  /**
   * Handle logout.
   */
  const handleLogout = async () : Promise<void> => {
    navigate('/logout', { replace: true });
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
   * Navigate to context menu settings.
   */
  const navigateToContextMenuSettings = () : void => {
    navigate('/settings/context-menu');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-gray-900 dark:text-white text-xl">{t('settings.title')}</h2>
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
                    {t('settings.loggedIn')}
                  </p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                title={t('settings.logout')}
                className="p-2 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 rounded-md transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                  aria-label={t('settings.logout')}
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
      </section>

      {/* Settings Navigation Section */}
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.preferences')}</h3>
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
                <span className="text-gray-900 dark:text-white">{t('settings.autofillSettings')}</span>
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
                <span className="text-gray-900 dark:text-white">{t('settings.contextMenuSettings')}</span>
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
                <span className="text-gray-900 dark:text-white">{t('settings.autoLockTimeout')}</span>
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
                <span className="text-gray-900 dark:text-white">{t('settings.clipboardSettings')}</span>
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
                <span className="text-gray-900 dark:text-white">{t('settings.language')}</span>
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

      {/* Appearance Settings Section */}
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.appearance')}</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div>
              <p className="font-medium text-gray-900 dark:text-white mb-2">{t('settings.theme')}</p>
              <div className="flex flex-col space-y-2">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="theme"
                    value="system"
                    checked={theme === 'system'}
                    onChange={() => setThemePreference('system')}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{t('settings.useDefault')}</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="theme"
                    value="light"
                    checked={theme === 'light'}
                    onChange={() => setThemePreference('light')}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{t('settings.light')}</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="theme"
                    value="dark"
                    checked={theme === 'dark'}
                    onChange={() => setThemePreference('dark')}
                    className="mr-2"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{t('settings.dark')}</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Keyboard Shortcuts Section */}
      {import.meta.env.CHROME && (
        <section>
          <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">{t('settings.keyboardShortcuts')}</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">{t('settings.configureKeyboardShortcuts')}</p>
                </div>
                <button
                  onClick={openKeyboardShortcuts}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
                >
                  {t('settings.configure')}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="text-center text-gray-400 dark:text-gray-600">
        {t('settings.versionPrefix')}{AppInfo.VERSION} ({getDisplayUrl()})
      </div>
    </div>
  );
};

export default Settings;