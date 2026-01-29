import React, { useEffect, useState, useRef } from 'react';
import { onMessage, sendMessage } from 'webext-bridge/popup';

/**
 * Clipboard countdown bar component.
 */
export const ClipboardCountdownBar: React.FC = () => {
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const animationRef = useRef<HTMLDivElement>(null);
  const currentCountdownIdRef = useRef<number>(0);

  /**
   * Starts the countdown animation.
   */
  const startAnimation = (remaining: number, total: number) : void => {
    // Use a small delay to ensure the component is fully rendered
    setTimeout(() => {
      if (animationRef.current) {
        // Calculate the starting percentage based on remaining time
        const percentage = (remaining / total) * 100;

        // Reset any existing animation
        animationRef.current.style.transition = 'none';
        animationRef.current.style.width = `${percentage}%`;

        // Force browser to flush styles
        void animationRef.current.offsetHeight;

        // Start animation from current position to 0
        requestAnimationFrame(() => {
          if (animationRef.current) {
            animationRef.current.style.transition = `width ${remaining}s linear`;
            animationRef.current.style.width = '0%';
          }
        });
      }
    }, 10);
  };

  useEffect(() => {
    // Request current countdown state on mount
    sendMessage('GET_CLIPBOARD_COUNTDOWN_STATE', {}, 'background').then((state) => {
      const countdownState = state as { remaining: number; total: number; id: number } | null;
      if (countdownState && countdownState.remaining > 0) {
        currentCountdownIdRef.current = countdownState.id;
        setIsVisible(true);
        startAnimation(countdownState.remaining, countdownState.total);
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
        startAnimation(remaining, total);
      }
    });

    // Listen for clipboard cleared message
    const unsubscribeClear = onMessage('CLIPBOARD_CLEARED', () => {
      setIsVisible(false);
      currentCountdownIdRef.current = 0;
      if (animationRef.current) {
        animationRef.current.style.transition = 'none';
        animationRef.current.style.width = '0%';
      }
    });

    // Listen for countdown cancelled message
    const unsubscribeCancel = onMessage('CLIPBOARD_COUNTDOWN_CANCELLED', () => {
      setIsVisible(false);
      currentCountdownIdRef.current = 0;
      if (animationRef.current) {
        animationRef.current.style.transition = 'none';
        animationRef.current.style.width = '0%';
      }
    });

    return () : void => {
      // Clean up listeners
      unsubscribe();
      unsubscribeClear();
      unsubscribeCancel();
    };
  }, []);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] h-1 bg-gray-200 dark:bg-gray-700">
      <div
        ref={animationRef}
        className="h-full bg-orange-500"
        style={{ width: '100%', transition: 'none' }}
      />
    </div>
  );
};
