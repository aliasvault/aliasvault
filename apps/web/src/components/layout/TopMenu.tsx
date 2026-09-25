import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation } from 'react-router-dom';

import CreateNewIdentityWidget from '@/components/layout/CreateNewIdentityWidget';
import DbLockButton from '@/components/layout/DbLockButton';
import DbStatusIndicator from '@/components/layout/DbStatusIndicator';
import SearchWidget from '@/components/layout/SearchWidget';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import { useClickOutside } from '@/hooks/useClickOutside';

/**
 * Class of a menu link, highlighting the active route.
 * @param isActive - whether the route is active
 * @param base - the base classes
 */
const navLinkClass = (isActive: boolean, base: string): string => `${base} ${isActive ? 'text-primary-700 dark:text-primary-500' : ''}`;

const DESKTOP_LINK = 'block text-gray-700 hover:text-primary-700 dark:text-gray-400 dark:hover:text-white';
const DROPDOWN_LINK = 'block py-2 px-4 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 dark:text-gray-400 dark:hover:text-white';

/**
 * The fixed top bar with navigation, search, quick create and user menu.
 */
const TopMenu: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { username } = useApp();
  const { isDarkMode, toggleTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  /**
   * Close the menu.
   */
  const closeMenu = useCallback((): void => setIsMobileMenuOpen(false), []);
  useClickOutside([menuRef, toggleRef], closeMenu, isMobileMenuOpen);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <header>
      <nav className="fixed z-30 w-full bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700 py-3 px-4">
        <div className="flex justify-between items-center max-w-screen-2xl mx-auto relative">
          <div className="flex flex-shrink-0 justify-start items-center relative">
            <NavLink to="/" className="flex mr-0 sm:mr-4 lg:mr-8">
              <img src="/img/icon-nopadding.png" className="mr-3 h-8 w-10" alt="AliasVault Logo" />
              <span className="self-center hidden sm:flex text-2xl font-semibold content-start align-top whitespace-nowrap dark:text-white">
                AliasVault
                <span className="text-primary-500 text-[10px] ml-1 font-normal hidden sm:inline-block">{t('layout.topMenu.BetaLabel')}</span>
              </span>
            </NavLink>

            <div className="hidden justify-between items-center w-full lg:flex lg:w-auto lg:order-1">
              <ul className="flex flex-col mt-4 space-x-6 text-sm font-medium lg:flex-row xl:space-x-8 lg:mt-0">
                <NavLink to="/items" end className={({ isActive }) => navLinkClass(isActive, DESKTOP_LINK)}>
                  {t('layout.topMenu.VaultNav')}
                </NavLink>
                <NavLink to="/emails" end className={({ isActive }) => navLinkClass(isActive, DESKTOP_LINK)}>
                  {t('layout.topMenu.EmailsNav')}
                </NavLink>
              </ul>
            </div>
          </div>

          <div className="flex-grow min-w-0 mr-4 ms-0 lg:ms-4">
            <SearchWidget />
          </div>

          <div className="flex justify-end items-center lg:order-2">
            <CreateNewIdentityWidget />
            <DbLockButton />
            <DbStatusIndicator />
            <button ref={toggleRef} onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} type="button" id="toggleMobileMenuButton" className="items-center p-2 text-gray-500 rounded-lg md:ml-2 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-700 focus:ring-4 focus:ring-gray-300 dark:focus:ring-gray-600" aria-expanded={isMobileMenuOpen}>
              <span className="sr-only">{t('layout.topMenu.OpenMenuLabel')}</span>
              <svg className="w-6 h-6" aria-hidden="true" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd"></path></svg>
            </button>
          </div>

          <div ref={menuRef} className={`absolute w-full md:w-64 top-[40px] md:top-[39px] right-0 z-50 my-4 text-base list-none bg-white rounded-b-lg divide-y divide-gray-100 shadow dark:bg-gray-700 dark:divide-gray-600 ${isMobileMenuOpen ? 'block' : 'hidden'}`} id="mobileMenuDropdown">
            <ul className="lg:hidden py-1 text-gray-700 dark:text-gray-400">
              <li>
                <NavLink to="/items" className={({ isActive }) => navLinkClass(isActive, DROPDOWN_LINK)}>
                  {t('layout.topMenu.VaultNav')}
                </NavLink>
              </li>
              <li>
                <NavLink to="/emails" end className={({ isActive }) => navLinkClass(isActive, DROPDOWN_LINK)}>
                  {t('layout.topMenu.EmailsNav')}
                </NavLink>
              </li>
            </ul>
            <div className="py-3 px-4">
              <span className="block text-sm font-semibold text-gray-900 dark:text-white">{username}</span>
            </div>
            <ul className="py-1 text-gray-700 dark:text-gray-400">
              <li>
                <NavLink to="/settings/general" end className={({ isActive }) => navLinkClass(isActive, DROPDOWN_LINK)}>
                  {t('layout.topMenu.GeneralSettingsNav')}
                </NavLink>
              </li>
              <li>
                <NavLink to="/settings/security" end className={({ isActive }) => navLinkClass(isActive, DROPDOWN_LINK)}>
                  {t('layout.topMenu.SecuritySettingsNav')}
                </NavLink>
              </li>
              <li>
                <NavLink to="/settings/storage-insights" end className={({ isActive }) => navLinkClass(isActive, DROPDOWN_LINK)}>
                  {t('layout.topMenu.StorageInsightsNav')}
                </NavLink>
              </li>
              <li>
                <NavLink to="/settings/import-export" end className={({ isActive }) => navLinkClass(isActive, DROPDOWN_LINK)}>
                  {t('layout.topMenu.ImportExportNav')}
                </NavLink>
              </li>
              <li className="border-t border-b border-gray-100 dark:border-gray-600">
                <NavLink to="/settings/apps" end className={({ isActive }) => navLinkClass(isActive, DROPDOWN_LINK)}>
                  {t('layout.topMenu.ExtensionsAppsNav')}
                  <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium rounded bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-200">
                    {t('layout.topMenu.NewLabel')}
                  </span>
                </NavLink>
              </li>
              <li>
                <button id="theme-toggle" type="button" onClick={toggleTheme} className="w-full text-start py-2 px-4 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 dark:text-gray-400 dark:hover:text-white">
                  {isDarkMode ? t('layout.topMenu.EnableLightMode') : t('layout.topMenu.EnableDarkMode')}
                  {isDarkMode ? (
                    <svg id="theme-toggle-light-icon" className="w-5 h-5 align-middle inline-block" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" fillRule="evenodd" clipRule="evenodd"></path></svg>
                  ) : (
                    <svg id="theme-toggle-dark-icon" className="w-5 h-5 align-middle inline-block" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"></path></svg>
                  )}
                </button>
              </li>
              <li>
                <NavLink to="/user/logout" className={({ isActive }) => `block py-2 px-4 font-bold text-sm text-primary-700 hover:bg-gray-100 dark:hover:bg-gray-600 dark:text-primary-200 dark:hover:text-white ${isActive ? 'text-primary-700 dark:text-primary-500' : ''}`}>
                  {t('layout.topMenu.LogOut')}
                </NavLink>
              </li>
            </ul>
          </div>
        </div>
      </nav>
    </header>
  );
};

export default TopMenu;
