import React, { useEffect, useState } from 'react';

type StickyActionBarProps = {
  children: React.ReactNode;
  /** Scroll offset in pixels past which the bar shows. */
  scrollThreshold?: number;
};

/**
 * Action bar fixed to the bottom of the viewport, shown once the page is scrolled past a threshold.
 */
const StickyActionBar: React.FC<StickyActionBarProps> = ({ children, scrollThreshold = 75 }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    /**
     * Show the bar when the page can scroll and is scrolled down.
     */
    const checkScroll = (): void => {
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      const canScroll = document.documentElement.scrollHeight > window.innerHeight + 50;
      setIsVisible(canScroll && scrollY > scrollThreshold);
    };
    window.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);
    const timer = setTimeout(checkScroll, 100);
    return (): void => {
      window.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
      clearTimeout(timer);
    };
  }, [scrollThreshold]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="sticky-action-bar-wrapper">
      <div className="h-20"></div>
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-4 py-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StickyActionBar;
