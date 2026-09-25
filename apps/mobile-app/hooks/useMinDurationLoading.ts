import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook for minimum duration loading state.
 * Ensures loading state stays active for at least the specified duration.
 * @param initialState - Initial loading state
 * @param minDuration - Minimum duration in milliseconds
 * @returns [loadingState, setLoadingState] - Loading state and setter function
 */
export const useMinDurationLoading = (
  initialState: boolean,
  minDuration: number
): [boolean, (newState: boolean) => void] => {
  const [state, setState] = useState(initialState);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStateWithMinDuration = useCallback(
    (newState: boolean) => {
      if (newState) {
        setState(true);
      } else {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => setState(false), minDuration);
      }
    },
    [minDuration]
  );

  useEffect(() => {
    return () : void => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return [state, setStateWithMinDuration];
};