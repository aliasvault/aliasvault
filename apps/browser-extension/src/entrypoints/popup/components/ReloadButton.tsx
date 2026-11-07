import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '@/entrypoints/popup/components/Icons/Icon';

/**
 * Reload button props.
 */
type ReloadButtonProps = {
  onClick: () => void | Promise<void>;
};

/**
 * Reload button that spins its icon for a moment after being clicked.
 */
const ReloadButton: React.FC<ReloadButtonProps> = ({ onClick }) => {
  const { t } = useTranslation();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return (): void => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  /**
   * Run the click handler and keep the icon spinning for half a second.
   */
  const handleClick = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    setIsRefreshing(true);
    await onClick();
    timerRef.current = setTimeout(() => setIsRefreshing(false), 500);
  }, [onClick]);

  return (
    <button
      id="reload-vault"
      type="button"
      onClick={() => void handleClick()}
      title={t('common.refresh')}
      aria-label={t('common.refresh')}
      className="w-8 h-8 flex-shrink-0 inline-flex items-center justify-center rounded-lg text-gray-700 bg-white ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-200 dark:bg-gray-800 dark:ring-gray-600 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 transition-colors"
    >
      <Icon name="refresh" className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
    </button>
  );
};

export default ReloadButton;
