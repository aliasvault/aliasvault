import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

type TabName = 'items' | 'emails' | 'settings';

type BottomNavProps = {
  scrollRef: React.RefObject<HTMLElement | null>;
};

/**
 * Stops the scroll-to-top animation that is running, if any.
 */
let stopScrollToTop: () => void = () => undefined;

/**
 * Scroll an element to the top twice as fast as the browser's smooth scrolling, which has no speed setting.
 */
function scrollToTop(el: HTMLElement): void {
  stopScrollToTop();
  const start = el.scrollTop;
  if (start <= 0) {
    return;
  }
  // Chromium's smooth scroll takes about 16 ms per square root of the distance in pixels; this takes half that.
  const duration = 8 * Math.sqrt(start);
  const startedAt = performance.now();
  let frame = 0;

  /**
   * End the animation, also when the user scrolls during it.
   */
  const stop = (): void => {
    cancelAnimationFrame(frame);
    el.removeEventListener('wheel', stop);
    el.removeEventListener('touchstart', stop);
  };

  /**
   * Move one frame along an ease-in-out curve.
   */
  const step = (now: number): void => {
    const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
    const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - ((2 - 2 * progress) ** 3) / 2;
    el.scrollTop = start * (1 - eased);
    if (progress < 1) {
      frame = requestAnimationFrame(step);
    } else {
      stop();
    }
  };

  el.addEventListener('wheel', stop, { passive: true });
  el.addEventListener('touchstart', stop, { passive: true });
  stopScrollToTop = stop;
  frame = requestAnimationFrame(step);
}

/**
 * Bottom nav component.
 */
const BottomNav: React.FC<BottomNavProps> = ({ scrollRef }) => {
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
   * Go to the root page of a tab, or scroll it back to the top when it is already shown, like the mobile app.
   * For items tab, pass state to signal the list should reset search/filters.
   */
  const handleTabChange = (tab: TabName) : void => {
    const isTabRoot = location.pathname === `/${tab}`;
    setCurrentTab(tab);
    if (isTabRoot && scrollRef.current) {
      scrollToTop(scrollRef.current);
    }
    if (tab === 'items') {
      // Navigate with state to signal ItemsList to reset search/filters
      navigate(`/${tab}`, { state: { resetFilters: true }, replace: isTabRoot });
    } else if (!isTabRoot) {
      navigate(`/${tab}`);
    }
  };

  // Auth pages that don't show bottom navigation but still show header
  const authPages = ['/', '/login', '/auth-settings', '/server-settings', '/server-settings/advanced', '/unlock', '/upgrade'];
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
    <div data-bottom-nav className="fixed bottom-0 left-0 right-0 z-[25] bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
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