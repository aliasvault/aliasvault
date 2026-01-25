import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';

import Logo from '@/entrypoints/popup/components/Logo';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { PopoutUtility } from '@/entrypoints/popup/utils/PopoutUtility';

import ServerSyncIndicator from './ServerSyncIndicator';

/**
 * Header props.
 */
type HeaderProps = {
  routes?: {
    path: string;
    showBackButton?: boolean;
    title?: string;
  }[];
  rightButtons?: React.ReactNode;
}

/**
 * Header component.
 */
const Header: React.FC<HeaderProps> = ({
  routes = [],
  rightButtons
}) => {
  const { t } = useTranslation();
  const app = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  // Updated route matching logic to handle URL parameters
  const currentRoute = routes?.find(route => {
    // Convert route pattern to regex
    const pattern = route.path.replace(/:\w+/g, '[^/]+');
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(location.pathname);
  });

  /**
   * Handle back button click.
   * Uses browser history if available, otherwise falls back to returnTo parameter
   * (used when opening expanded popup from Firefox narrow popup).
   */
  const handleBack = useCallback((): void => {
    // Check if we have a returnTo path (set when opening expanded popup)
    const returnPath = PopoutUtility.getReturnPath();

    // If we're in an expanded popup with a returnTo path and no history, use it
    if (returnPath && PopoutUtility.isPopup() && window.history.length <= 2) {
      navigate(returnPath);
    } else {
      navigate(-1);
    }
  }, [navigate]);

  /**
   * Handle settings.
   */
  const handleSettings = () : void => {
    navigate('/auth-settings');
  };

  /**
   * Handle logo click.
   */
  const logoClick = () : void => {
    // Don't navigate if on upgrade page or login page
    if (location.pathname === '/upgrade' || location.pathname === '/login' || location.pathname === '/unlock') {
      return;
    }

    // If logged in, navigate to items.
    if (app.isLoggedIn) {
      navigate('/items');
    } else {
      // If not logged in, navigate to index.
      navigate('/');
    }
  };

  return (
    <header className="fixed z-30 w-full bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center h-16 px-4">
        {currentRoute?.showBackButton ? (
          <button
            id="back"
            onClick={handleBack}
            className="flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 pr-2 pt-1.5 pb-1.5 rounded-lg group"
          >
            <div className="flex items-center">
              <svg className="w-5 h-5 text-gray-500 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              {currentRoute.title && (
                <h1 className="text-lg font-medium text-gray-900 dark:text-white ml-2">
                  {currentRoute.title}
                </h1>
              )}
            </div>
          </button>
        ) : (
          <div className="flex items-center">
            <button
              onClick={() => logoClick()}
              className="flex items-center hover:opacity-80 transition-opacity"
            >
              <Logo
                width={125}
                height={40}
                showText={true}
                className="text-gray-900 dark:text-white"
              />
              {/* Hide beta badge on Safari as it's not allowed to show non-production badges */}
              {!import.meta.env.SAFARI && (
                <span className="text-primary-500 text-[10px] font-normal">BETA</span>
              )}
            </button>
          </div>
        )}

        <div className="flex-grow" />

        {/* Server sync indicator */}
        <ServerSyncIndicator />

        <div className="flex items-center gap-2">
          {!app.isLoggedIn ? (
            <>
              {rightButtons}
              <button
                id="settings"
                onClick={(handleSettings)}
                className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <span className="sr-only">{t('common.settings')}</span>
                <svg className="w-5 h-5" aria-hidden="true" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                  <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                </svg>
              </button>
            </>
          ) : (
            rightButtons
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
