import React, { useEffect, useState, useRef } from 'react';
import { onMessage, sendMessage } from 'webext-bridge/popup';

import { CountdownBar, ICountdownBarHandle } from './CountdownBar';

/**
 * Clipboard countdown bar component.
 * Listens for clipboard countdown events from the background script and displays the countdown bar.
 */
export const ClipboardCountdownBar: React.FC = () => {
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const countdownBarRef = useRef<ICountdownBarHandle>(null);
  const currentCountdownIdRef = useRef<number>(0);

  /**
   * Starts the countdown animation with remaining time.
   */
  const startAnimation = (remaining: number, total: number): void => {
    // Calculate the starting percentage based on remaining time
    const percentage = remaining / total;
    // Start animation for the remaining duration
    countdownBarRef.current?.startAnimation(remaining * percentage);
  };

  /**
   * Stops the animation.
   */
  const stopAnimation = (): void => {
    countdownBarRef.current?.stopAnimation();
  };

  useEffect(() => {
    // Request current countdown state on mount
    sendMessage('GET_CLIPBOARD_COUNTDOWN_STATE', {}, 'background').then((state) => {
      const countdownState = state as { remaining: number; total: number; id: number } | null;
      if (countdownState && countdownState.remaining > 0) {
        currentCountdownIdRef.current = countdownState.id;
        setIsVisible(true);
        // Use setTimeout to ensure the component has rendered
        setTimeout(() => {
          startAnimation(countdownState.remaining, countdownState.total);
        }, 0);
      }
    }).catch(() => {
      // No active countdown
    });

    // Listen for countdown updates from background script
    const unsubscribe = onMessage('CLIPBOARD_COUNTDOWN', ({ data }) => {
      const { remaining, total, id } = data as { remaining: number; total: number; id: number };
      setIsVisible(remaining > 0);

      // Check if this is a new countdown (different ID)
      const isNewCountdown = id !== currentCountdownIdRef.current;

      // Start animation when new countdown begins
      if (isNewCountdown && remaining > 0) {
        currentCountdownIdRef.current = id;
        // Use setTimeout to ensure visibility state has updated
        setTimeout(() => {
          startAnimation(remaining, total);
        }, 0);
      }
    });

    // Listen for clipboard cleared message
    const unsubscribeClear = onMessage('CLIPBOARD_CLEARED', () => {
      setIsVisible(false);
      currentCountdownIdRef.current = 0;
      stopAnimation();
    });

    // Listen for countdown cancelled message
    const unsubscribeCancel = onMessage('CLIPBOARD_COUNTDOWN_CANCELLED', () => {
      setIsVisible(false);
      currentCountdownIdRef.current = 0;
      stopAnimation();
    });

    return (): void => {
      // Clean up listeners
      unsubscribe();
      unsubscribeClear();
      unsubscribeCancel();
    };
  }, []);

  return (
    <CountdownBar
      ref={countdownBarRef}
      isVisible={isVisible}
      colorClass="bg-orange-500"
    />
  );
};
