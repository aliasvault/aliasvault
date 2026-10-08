import React, { useCallback, useEffect, useRef, useState } from 'react';

import Button from '@/components/shared/Button';
import Icon from '@/components/shared/Icon';

type RefreshButtonProps = {
  onClick: () => void | Promise<void>;
  buttonText: string;
  iconOnly?: boolean;
  additionalClasses?: string;
};

/**
 * Secondary (outline) refresh button that spins its icon for a moment after being clicked.
 */
const RefreshButton: React.FC<RefreshButtonProps> = ({ onClick, buttonText, iconOnly = false, additionalClasses = '' }) => {
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
    <Button onClick={() => void handleClick()} display="flex" color="outline" additionalClasses={additionalClasses}>
      <Icon name="refresh" className={`${iconOnly ? 'w-5 h-5' : 'w-4 h-4'} ${isRefreshing ? 'animate-spin-ccw' : ''}`} />
      <span className={iconOnly ? 'sr-only' : 'ml-2'}>{buttonText}</span>
    </Button>
  );
};

export default RefreshButton;
