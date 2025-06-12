import React, { useEffect, useState, useCallback } from 'react';
import { sendMessage } from 'webext-bridge/popup';

import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/icons/HeaderIcons';
import { useAuth } from '@/entrypoints/popup/context/AuthContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
import { useTheme } from '@/entrypoints/popup/context/ThemeContext';

import { AppInfo } from '@/utils/AppInfo';
import { DISABLED_SITES_KEY, GLOBAL_AUTOFILL_POPUP_ENABLED_KEY, GLOBAL_CONTEXT_MENU_ENABLED_KEY, TEMPORARY_DISABLED_SITES_KEY } from '@/utils/Constants';

import { useLoading } from '../context/LoadingContext';

import { storage, browser } from "#imports";

/**
 * Popup settings type.
 */
type PopupSettings = {
  disabledUrls: string[];
  temporaryDisabledUrls: Record<string, number>;
  currentUrl: string;
  isEnabled: boolean;
  isGloballyEnabled: boolean;
  isContextMenuEnabled: boolean;
}

/**
 * Settings page component.
 */
const Settings: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const authContext = useAuth();
  const { setHeaderButtons } = useHeaderButtons();
  const { setIsInitialLoading } = useLoading();
  const [settings, setSettings] = useState<PopupSettings>({
    disabledUrls: [],
    temporaryDisabledUrls: {},
    currentUrl: '',
    isEnabled: true,
    isGloballyEnabled: true,
    isContextMenuEnabled: true
  });

  /**
   * Get current tab in browser.
   */
  const getCurrentTab = async (): Promise<browser.Tabs.Tab> => {
    const queryOptions = { active: true, currentWindow: true };
    const [tab] = await browser.tabs.query(queryOptions);
    return tab;
  };

  /**
   * Open the client tab.
   */
  const openClientTab = async () : Promise<void> => {
    const settingClientUrl = await storage.getItem('local:clientUrl') as string;
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
        <HeaderButton
          onClick={openClientTab}
          title="Open web app"
          iconType={HeaderIconType.EXTERNAL_LINK}
        />
      </div>
    );

    setHeaderButtons(headerButtonsJSX);
    return () => setHeaderButtons(null);
  }, [setHeaderButtons]);

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
    const isContextMenuEnabled = await storage.getItem(GLOBAL_CONTEXT_MENU_ENABLED_KEY) !== false; // Default to true if not set

    // Clean up expired temporary disables
    const now = Date.now();
    const cleanedTemporaryDisabledUrls = Object.fromEntries(
      Object.entries(temporaryDisabledUrls).filter(([_, expiry]) => expiry > now)
    );

    if (Object.keys(cleanedTemporaryDisabledUrls).length !== Object.keys(temporaryDisabledUrls).length) {
      await storage.setItem(TEMPORARY_DISABLED_SITES_KEY, cleanedTemporaryDisabledUrls);
    }

    setSettings({
      disabledUrls,
      temporaryDisabledUrls: cleanedTemporaryDisabledUrls,
      currentUrl,
      isEnabled: !disabledUrls.includes(currentUrl) && !(currentUrl in cleanedTemporaryDisabledUrls),
      isGloballyEnabled,
      isContextMenuEnabled
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
   * Toggle context menu.
   */
  const toggleContextMenu = async () : Promise<void> => {
    const newContextMenuEnabled = !settings.isContextMenuEnabled;

    await storage.setItem(GLOBAL_CONTEXT_MENU_ENABLED_KEY, newContextMenuEnabled);
    await sendMessage('TOGGLE_CONTEXT_MENU', { enabled: newContextMenuEnabled }, 'background');

    setSettings(prev => ({
      ...prev,
      isContextMenuEnabled: newContextMenuEnabled
    }));
  };

  /**
   * Set theme preference.
   */
  const setThemePreference = async (newTheme: 'system' | 'light' | 'dark') : Promise<void> => {
    // Use the ThemeContext to apply the theme
    setTheme(newTheme);

    // Update local state
    setSettings(prev => ({
      ...prev,
      theme: newTheme
    }));
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
    await authContext.logout();
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-gray-900 dark:text-white text-xl">Settings</h2>
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
                      {authContext.username?.[0]?.toUpperCase() || '?'}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {authContext.username}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Logged in
                  </p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Global Settings Section */}
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">Global Settings</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Autofill popup</p>
                <p className={`text-sm mt-1 ${settings.isGloballyEnabled ? 'text-gray-600 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}>
                  {settings.isGloballyEnabled ? 'Active on all sites (unless disabled below)' : 'Disabled on all sites'}
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
                {settings.isGloballyEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Right-click context menu</p>
                <p className={`text-sm mt-1 ${settings.isContextMenuEnabled ? 'text-gray-600 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}>
                  {settings.isContextMenuEnabled ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              <button
                onClick={toggleContextMenu}
                className={`px-4 py-2 rounded-md transition-colors ${
                  settings.isContextMenuEnabled
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                {settings.isContextMenuEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Site-Specific Settings Section */}
      {settings.isGloballyEnabled && (
        <section>
          <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">Site-Specific Settings</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Autofill popup on: {settings.currentUrl}</p>
                  <p className={`text-sm mt-1 ${settings.isEnabled ? 'text-gray-600 dark:text-gray-400' : 'text-red-600 dark:text-red-400'}`}>
                    {settings.isEnabled ? 'Enabled for this site' : 'Disabled for this site'}
                  </p>
                  {!settings.isEnabled && settings.temporaryDisabledUrls[settings.currentUrl] && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Temporarily disabled until {new Date(settings.temporaryDisabledUrls[settings.currentUrl]).toLocaleTimeString()}
                    </p>
                  )}
                </div>
                {settings.isGloballyEnabled && (
                  <button
                    onClick={toggleCurrentSite}
                    className={`px-4 py-2 rounded-md transition-colors ${
                      settings.isEnabled
                        ? 'bg-green-500 hover:bg-green-600 text-white'
                        : 'bg-red-500 hover:bg-red-600 text-white'
                    }`}
                  >
                    {settings.isEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                )}
              </div>

              <div className="mt-4">
                <button
                  onClick={resetSettings}
                  className="w-full px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 rounded-md text-gray-700 dark:text-gray-300 transition-colors text-sm"
                >
                  Reset all site-specific settings
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Appearance Settings Section */}
      <section>
        <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">Appearance</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="p-4">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">Theme</p>
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
                  <span className="text-sm text-gray-700 dark:text-gray-300">Use default</span>
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
                  <span className="text-sm text-gray-700 dark:text-gray-300">Light</span>
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
                  <span className="text-sm text-gray-700 dark:text-gray-300">Dark</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Keyboard Shortcuts Section */}
      {import.meta.env.CHROME && (
        <section>
          <h3 className="text-md font-semibold text-gray-900 dark:text-white mb-3">Keyboard Shortcuts</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Configure keyboard shortcuts</p>
                </div>
                <button
                  onClick={openKeyboardShortcuts}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
                >
                  Configure
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="text-center text-gray-400 dark:text-gray-600">
        Version: {AppInfo.VERSION}
      </div>
    </div>
  );
};

export default Settings;