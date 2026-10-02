import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

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
  const authPages = ['/', '/login', '/auth-settings', '/unlock', '/upgrade'];
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
    <div data-bottom-nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      <div className="flex justify-around items-center h-14">
        <button
          onClick={() => handleTabChange('items')}
          id="nav-vault"
          className={`flex flex-col items-center justify-center w-1/3 h-full ${
            currentTab === 'items' ? 'text-primary-600 dark:text-primary-500' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <Icon name="key" className="w-6 h-6" />
          <span className="text-sm mt-1">{t('navigation.vault')}</span>
        </button>
        <button
          onClick={() => handleTabChange('emails')}
          id="nav-emails"
          className={`flex flex-col items-center justify-center w-1/3 h-full ${
            currentTab === 'emails' ? 'text-primary-600 dark:text-primary-500' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <Icon name="mail" className="w-6 h-6" />
          <span className="text-sm mt-1">{t('emails.title')}</span>
        </button>
        <button
          onClick={() => handleTabChange('settings')}
          id="nav-settings"
          className={`flex flex-col items-center justify-center w-1/3 h-full ${
            currentTab === 'settings' ? 'text-primary-600 dark:text-primary-500' : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <Icon name="cog" className="w-6 h-6" />
          <span className="text-sm mt-1">{t('common.settings')}</span>
        </button>
      </div>
    </div>
  );
};

export default BottomNav;