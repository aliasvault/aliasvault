import { useRef, useCallback } from 'react';

/**
 * Hook to prevent rapid successive navigation calls.
 * This prevents the common issue where users accidentally tap navigation items
 * multiple times in quick succession, causing duplicate navigation.
 *
 * @param delay - Debounce delay in milliseconds (default: 300ms)
 * @returns A debounced navigation function that accepts a callback
 */
export const useNavigationDebounce = (delay: number = 300) => {
  const isNavigating = useRef(false);

  const navigate = useCallback(
    (navigationFn: () => void) => {
      // If already navigating, ignore this call
      if (isNavigating.current) {
        return;
      }

      // Set flag to prevent further calls
      isNavigating.current = true;

      // Execute the navigation function
      navigationFn();

      // Reset the flag after the delay
      setTimeout(() => {
        isNavigating.current = false;
      }, delay);
    },
    [delay]
  );

  return navigate;
};
