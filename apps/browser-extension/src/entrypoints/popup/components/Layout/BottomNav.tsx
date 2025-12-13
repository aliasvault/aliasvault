import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';

type TabName = 'items' | 'emails' | 'settings';

/**
 * Bottom nav component.
 */
const BottomNav: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [currentTab, setCurrentTab] = useState<TabName>('items');

  // Add effect to update currentTab based on route
  useEffect(() => {
    const path = location.pathname.substring(1); // Remove leading slash
    const tabNames: TabName[] = ['items', 'emails', 'settings'];

    // Find the first tab name that matches the start of the path
    const matchingTab = tabNames.find(tab => path === tab || path.startsWith(`${tab}/`));
    if (matchingTab) {
      setCurrentTab(matchingTab);
    }
  }, [location]);

  /**
   * Handle tab change.
   * For items tab, pass state to signal the list should reset search/filters.
   */
  const handleTabChange = (tab: TabName) : void => {
    setCurrentTab(tab);
    if (tab === 'items') {
      // Navigate with state to signal ItemsList to reset search/filters
      navigate(`/${tab}`, { state: { resetFilters: true } });
    } else {
      navigate(`/${tab}`);
    }
  };

  // Auth pages that don't show bottom navigation but still show header
  const authPages = ['/', '/login', '/auth-settings', '/unlock', '/unlock-success', '/upgrade'];
  const isAuthPage = authPages.includes(location.pathname);

  if (isAuthPage) {
    return null;
  }

  // Detect if the user is coming from the unlock page with mode=inline_unlock.
  const urlParams = new URLSearchParams(window.location.search);
  const isInlineUnlockMode = urlParams.get('mode') === 'inline_unlock';

  if (isInlineUnlockMode) {
    // Do not show the bottom nav for inline unlock mode.
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      <div className="flex justify-around items-center h-14">
        <button
          onClick={() => handleTabChange('items')}
          id="nav-vault"
          className={`flex flex-col items-center justify-center w-1/3 h-full ${
            currentTab === 'items' ? 'text-primary-600 dark:text-primary-500' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          <span className="text-sm mt-1">{t('menu.vault')}</span>
        </button>
        <button
          onClick={() => handleTabChange('emails')}
          id="nav-emails"
          className={`flex flex-col items-center justify-center w-1/3 h-full ${
            currentTab === 'emails' ? 'text-primary-600 dark:text-primary-500' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className="text-sm mt-1">{t('menu.emails')}</span>
        </button>
        <button
          onClick={() => handleTabChange('settings')}
          id="nav-settings"
          className={`flex flex-col items-center justify-center w-1/3 h-full ${
            currentTab === 'settings' ? 'text-primary-600 dark:text-primary-500' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm mt-1">{t('menu.settings')}</span>
        </button>
      </div>
    </div>
  );
};

export default BottomNav;