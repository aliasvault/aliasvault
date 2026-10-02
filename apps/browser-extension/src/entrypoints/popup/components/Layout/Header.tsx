import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';

import HeaderButton from '@/entrypoints/popup/components/HeaderButton';
import { HeaderIconType } from '@/entrypoints/popup/components/Icons/HeaderIcons';
import Icon from '@/entrypoints/popup/components/Icons/Icon';
import Logo from '@/entrypoints/popup/components/Logo';
import { useApp } from '@/entrypoints/popup/context/AppContext';
import { useHeaderButtons } from '@/entrypoints/popup/context/HeaderButtonsContext';
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
  const [searchParams] = useSearchParams();
  const { backButtonTitle: customBackButtonTitle } = useHeaderButtons();

  // Updated route matching logic to handle URL parameters
  const currentRoute = routes?.find(route => {
    // Convert route pattern to regex
    const pattern = route.path.replace(/:\w+/g, '[^/]+');
    const regex = new RegExp(`^${pattern}$`);
    return regex.test(location.pathname);
  });

  /**
   * Determine the back button title.
   * Priority: 1. Custom title from page (via context), 2. Static title from route config
   */
  const backButtonTitle = useMemo(() => {
    // If no back button, return undefined
    if (!currentRoute?.showBackButton) {
      return currentRoute?.title;
    }

    // Priority 1: Use custom back button title if set by the page
    if (customBackButtonTitle) {
      return customBackButtonTitle;
    }

    // Priority 2: Use static title from route config
    return currentRoute?.title;
  }, [currentRoute, customBackButtonTitle]);

  /**
   * Handle back button click.
   * Uses browser history if available, otherwise falls back to returnTo parameter
   * (used when opening expanded popup from Firefox narrow popup).
   */
  const handleBack = useCallback((): void => {
    // Check if we have a returnTo path (set when opening expanded popup)
    const returnPath = PopoutUtility.getReturnPath();

    // Check if we're on an item details page with a returnSearch param
    const returnSearch = searchParams.get('returnSearch');
    const isItemDetailsPage = /^\/items\/[^/]+\/[^/]+$/.test(location.pathname);

    if (isItemDetailsPage && returnSearch) {
      // Navigate back to items list with search query
      navigate(`/items?search=${encodeURIComponent(returnSearch)}`);
    } else if (returnPath && PopoutUtility.isPopup() && window.history.length <= 2) {
      // If we're in an expanded popup with a returnTo path and no history, use it
      navigate(returnPath);
    } else {
      navigate(-1);
    }
  }, [navigate, searchParams, location.pathname]);

  /**
   * Keyboard navigation:
   *  - ArrowLeft → back action when focus isn't in a text input.
   */
  useEffect(() => {
    if (!currentRoute?.showBackButton) {
      return;
    }
    /**
     * Document keydown listener that fires the back action on plain ArrowLeft.
     */
    const handler = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) {
        return;
      }
      if (e.key !== 'ArrowLeft' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
        return;
      }
      const target = e.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) {
          return;
        }
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          return;
        }
      }
      e.preventDefault();
      handleBack();
    };
    document.addEventListener('keydown', handler);
    return (): void => document.removeEventListener('keydown', handler);
  }, [currentRoute?.showBackButton, handleBack]);

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
      // Navigate to items list and reset filters (if any).
      navigate('/items', { state: { resetFilters: true } });
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
              <Icon name="chevron-left" className="w-5 h-5 text-gray-500 group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-white" />
              {backButtonTitle && (
                <h1 className="text-lg font-medium text-gray-900 dark:text-white ml-2">
                  {backButtonTitle}
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
              {location.pathname !== '/auth-settings' && (
                <HeaderButton id="settings" onClick={handleSettings} title={t('common.settings')} iconType={HeaderIconType.SETTINGS} />
              )}
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
