import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Return type for the useNavigationHistory hook.
 */
interface INavigationHistory {
  /**
   * Find how many steps back we need to go to reach the target path.
   * Returns null if the path is not in the history stack.
   */
  findStepsBack: (targetPath: string) => number | null;
}

/**
 * Custom hook to track navigation history within the React app.
 * This allows us to determine if a path exists in the current navigation stack
 * and calculate how many steps back we need to go.
 */
export const useNavigationHistory = (): INavigationHistory => {
  const location = useLocation();
  const navigationType = useNavigationType();
  const historyRef = useRef<string[]>([]);

  useEffect(() => {
    if (navigationType === 'REPLACE') {
      // Mirror the replace in our tracked stack so the current entry stays accurate.
      if (historyRef.current.length === 0) {
        historyRef.current.push(location.pathname + location.search);
      } else {
        historyRef.current[historyRef.current.length - 1] = location.pathname + location.search;
      }
      return;
    }

    const currentPath = location.pathname + location.search;

    // Check if this is a back/forward navigation by looking for the path in history
    const existingIndex = historyRef.current.indexOf(currentPath);

    if (existingIndex !== -1) {
      // User navigated back - trim history to this point
      historyRef.current = historyRef.current.slice(0, existingIndex + 1);
    } else {
      // New navigation - add to history
      historyRef.current.push(currentPath);
    }
  }, [location, navigationType]);

  /**
   * Find how many steps back we need to go to reach the target path.
   * Returns null if the path is not in the history stack.
   */
  const findStepsBack = (targetPath: string): number | null => {
    const currentIndex = historyRef.current.length - 1;
    const targetIndex = historyRef.current.lastIndexOf(targetPath);

    if (targetIndex === -1 || targetIndex === currentIndex) {
      return null; // Path not in history or is current page
    }

    return currentIndex - targetIndex;
  };

  return { findStepsBack };
};
