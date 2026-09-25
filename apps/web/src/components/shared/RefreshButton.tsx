import React, { useCallback, useEffect, useRef, useState } from 'react';

import Button, { type ButtonColor } from '@/components/shared/Button';

type RefreshButtonProps = {
  onClick: () => void | Promise<void>;
  buttonText: string;
  color?: ButtonColor;
  additionalClasses?: string;
};

/**
 * Refresh button that spins its icon for a moment after being clicked.
 */
const RefreshButton: React.FC<RefreshButtonProps> = ({ onClick, buttonText, color = 'primary', additionalClasses = '' }) => {
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
    if (isRefreshing) {
      return;
    }
    setIsRefreshing(true);
    await onClick();
    timerRef.current = setTimeout(() => setIsRefreshing(false), 500);
  }, [isRefreshing, onClick]);

  return (
    <Button onClick={handleClick} isDisabled={isRefreshing} display="flex" color={color} additionalClasses={additionalClasses}>
      <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin-ccw' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
      </svg>
      <span className="ml-2">{buttonText}</span>
    </Button>
  );
};

export default RefreshButton;
