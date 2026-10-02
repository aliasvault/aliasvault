import { familySharingText } from '@aliasvault/client/sharing/FamilySharingView';
import { ItemTypes } from '@aliasvault/models/vault';
import { CapabilityKeys } from '@aliasvault/models/webapi';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

import QuickCreateDialog from '@/components/items/QuickCreateDialog';
import DbLockButton from '@/components/layout/DbLockButton';
import DbStatusIndicator from '@/components/layout/DbStatusIndicator';
import NavBarLink from '@/components/layout/NavBarLink';
import SearchWidget from '@/components/layout/SearchWidget';
import SettingsIcon, { type SettingsIconName } from '@/components/settings/SettingsIcon';
import MenuItem from '@/components/shared/MenuItem';
import { useAccountReminders } from '@/context/AccountReminderContext';
import { useAuth } from '@/context/AuthContext';
import { useCapabilities } from '@/context/CapabilityContext';
import { useTheme } from '@/context/ThemeContext';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useConfirmLogout } from '@/hooks/useConfirmLogout';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcut';

/**
 * One link in the account menu.
 */
const AccountMenuLink: React.FC<{ to: string; icon: SettingsIconName; label: string; onNavigate: () => void; children?: React.ReactNode }> = ({ to, icon, label, onNavigate, children }) => (
  <MenuItem to={to} onClick={onNavigate} icon={<SettingsIcon name={icon} className="w-5 h-5" />} label={label}>{children}</MenuItem>
);

/**
 * The fixed top bar with navigation, search, quick create and the account menu.
 */
const TopMenu: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { username } = useAuth();
  const hasCapability = useCapabilities();
  const { isDarkMode, toggleTheme } = useTheme();
  const confirmLogout = useConfirmLogout();
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false);
  const quickCreateRef = useRef<HTMLDivElement>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);
  const { reminders, hasReminders, refresh: refreshReminders } = useAccountReminders();

  const closeUserMenu = useCallback((): void => setIsUserMenuOpen(false), []);
  useClickOutside([userMenuRef, userButtonRef], closeUserMenu, isUserMenuOpen);

  const closeQuickCreate = useCallback((): void => setIsQuickCreateOpen(false), []);
  useClickOutside([quickCreateRef], closeQuickCreate, isQuickCreateOpen);
  const openQuickCreate = useCallback((): void => setIsQuickCreateOpen(true), []);
  useKeyboardShortcut('gc', openQuickCreate);

  const goHome = useCallback((): void => void navigate('/'), [navigate]);
  useKeyboardShortcut('gh', goHome);

  useEffect(() => {
    setIsUserMenuOpen(false);
    setIsQuickCreateOpen(false);
  }, [location.pathname]);

  // Re-check when the account menu opens.
  useEffect(() => {
    if (isUserMenuOpen) {
      void refreshReminders();
    }
  }, [isUserMenuOpen, refreshReminders]);

  return (
    <header>
      <nav className="fixed z-30 w-full bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700 py-3 px-4">
        <div className="flex justify-between items-center max-w-screen-2xl mx-auto relative">
          <div className="flex flex-shrink-0 justify-start items-center relative">
            <NavLink to="/" className="flex mr-0 sm:mr-4 lg:mr-8">
              <img src="/img/logo-cropped.png" className="mr-3 h-8 w-10" alt="AliasVault Logo" />
              <span className="self-center hidden sm:flex text-2xl font-semibold content-start align-top whitespace-nowrap dark:text-white">
                AliasVault
                <span className="text-primary-500 text-[10px] ml-1 font-normal hidden sm:inline-block">{t('web.topMenu.betaLabel')}</span>
              </span>
            </NavLink>

            <div className="hidden justify-between items-center w-full lg:flex lg:w-auto lg:order-1">
              <ul className="flex flex-col mt-4 space-x-6 text-sm font-medium lg:flex-row xl:space-x-8 lg:mt-0">
                <NavBarLink to="/items">{t('navigation.vault')}</NavBarLink>
                <NavBarLink to="/emails">{t('emails.title')}</NavBarLink>
              </ul>
            </div>
          </div>

          <div className="flex-grow min-w-0 mr-4 ms-0 lg:ms-4">
            <SearchWidget />
          </div>

          <div className="flex justify-end items-center lg:order-2">
            <DbStatusIndicator />
            <div ref={quickCreateRef} className="relative ms-1 md:ms-2">
              <button type="button" id="topBarQuickCreateButton" onClick={() => setIsQuickCreateOpen(!isQuickCreateOpen)} aria-expanded={isQuickCreateOpen} title={t('items.quickCreate.newAliasButtonText')} className="flex items-center justify-center h-9 w-9 md:w-auto md:px-4 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 transition-colors">
                <svg className="w-5 h-5 md:hidden" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2.25} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" /></svg>
                <span className="sr-only md:not-sr-only">{t('items.quickCreate.newAliasButtonText')}</span>
              </button>
              {isQuickCreateOpen && <QuickCreateDialog variant="popover" initialType={ItemTypes.Login} onClose={closeQuickCreate} />}
            </div>
            <div className="relative ms-3 md:ms-4">
              <button ref={userButtonRef} onClick={() => setIsUserMenuOpen(!isUserMenuOpen)} type="button" id="userMenuButton" title={username ?? ''} aria-expanded={isUserMenuOpen} className={`flex items-center gap-2 h-9 rounded-full md:pl-0.5 md:pr-2.5 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors ${isUserMenuOpen ? 'bg-gray-100 dark:bg-gray-700' : ''}`}>
                <span className="relative flex items-center justify-center w-9 h-9 md:w-8 md:h-8 rounded-full text-sm font-semibold bg-primary-100 text-primary-700 dark:bg-primary-900/60 dark:text-primary-300">
                  {username?.[0]?.toUpperCase() ?? '?'}
                  {hasReminders && <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-primary-500 ring-2 ring-white dark:ring-gray-800" aria-hidden="true" />}
                </span>
                <span className="hidden md:block max-w-[8rem] truncate text-sm font-medium text-gray-700 dark:text-gray-200">{username}</span>
                <svg className={`hidden md:block w-4 h-4 text-gray-400 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </button>
              <div ref={userMenuRef} id="userMenu" className={`absolute right-0 top-full mt-3 w-72 z-50 overflow-hidden bg-white rounded-lg shadow-lg border border-gray-200 dark:bg-gray-700 dark:border-gray-600 ${isUserMenuOpen ? 'block' : 'hidden'}`}>
                <div className="flex items-start gap-2 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{t('auth.loggedInAs')}</span>
                    <span className="block text-sm font-semibold text-gray-900 dark:text-white break-all">{username}</span>
                  </div>
                  <button type="button" id="theme-toggle" onClick={toggleTheme} title={isDarkMode ? t('web.topMenu.enableLightMode') : t('web.topMenu.enableDarkMode')} className="flex-shrink-0 p-1.5 -mr-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-600 transition-colors">
                    <span className="sr-only">{isDarkMode ? t('web.topMenu.enableLightMode') : t('web.topMenu.enableDarkMode')}</span>
                    <SettingsIcon name={isDarkMode ? 'themeLight' : 'themeDark'} className="w-5 h-5" />
                  </button>
                </div>
                <div className="lg:hidden border-t border-gray-100 dark:border-gray-600 py-1">
                  <AccountMenuLink onNavigate={closeUserMenu} to="/items" icon="vault" label={t('navigation.vault')} />
                  <AccountMenuLink onNavigate={closeUserMenu} to="/emails" icon="emails" label={t('emails.title')} />
                </div>
                <div className="border-t border-gray-100 dark:border-gray-600 py-1">
                  {hasCapability(CapabilityKeys.VaultSharing) && (
                    <AccountMenuLink onNavigate={closeUserMenu} to="/settings/family-sharing" icon="familySharing" label={familySharingText.title}>
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200">{familySharingText.beta}</span>
                    </AccountMenuLink>
                  )}
                  <AccountMenuLink onNavigate={closeUserMenu} to="/settings/two-factor" icon="twoFactor" label={t('common.twoFactorAuthentication')}>
                    {reminders.enableTwoFactor && (
                      <span title={t('settings.securitySettings.twoFactor.disabledMessage')} className="flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
                        <SettingsIcon name="warning" className="w-4 h-4" />
                        <span className="sr-only">{t('common.disabled')}</span>
                      </span>
                    )}
                  </AccountMenuLink>
                  <AccountMenuLink onNavigate={closeUserMenu} to="/settings/import-export" icon="importExport" label={t('settings.importExport')} />
                  <AccountMenuLink onNavigate={closeUserMenu} to="/settings/apps" icon="apps" label={t('settings.apps.pageTitle')} />
                </div>
                <div className="border-t border-gray-100 dark:border-gray-600 py-1">
                  <AccountMenuLink onNavigate={closeUserMenu} to="/settings" icon="general" label={t('common.settings')} />
                </div>
                <div className="border-t border-gray-100 dark:border-gray-600 pt-1">
                  <DbLockButton />
                  <MenuItem id="userMenuLogoutButton" danger icon={<SettingsIcon name="logout" className="w-5 h-5" />} label={t('web.topMenu.logOut')} onClick={() => {
                    setIsUserMenuOpen(false);
                    void confirmLogout();
                  }} />
                </div>
              </div>
            </div>
          </div>

        </div>
      </nav>
    </header>
  );
};

export default TopMenu;
