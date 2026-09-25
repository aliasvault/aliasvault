import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook that keeps a loading state true for a minimum duration, so a fast load does not flicker.
 * @param initialState - initial loading state
 * @param minDuration - minimum duration in milliseconds
 * @returns [isLoading, setIsLoading]
 */
export const useMinDurationLoading = (initialState: boolean = false, minDuration: number = 300): [boolean, (value: boolean) => void] => {
  const [isLoading, setIsLoading] = useState(initialState);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number | null>(null);

  const setLoadingState = useCallback((value: boolean) => {
    if (value) {
      setIsLoading(true);
      startTimeRef.current = Date.now();
      return;
    }

    const elapsedTime = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
    const remainingTime = Math.max(0, minDuration - elapsedTime);

    if (remainingTime === 0) {
      setIsLoading(false);
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setIsLoading(false);
      }, remainingTime);
    }
  }, [minDuration]);

  useEffect(() => {
    if (initialState) {
      setIsLoading(true);
      startTimeRef.current = Date.now();
    }
  }, [initialState]);

  useEffect(() => {
    return (): void => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return [isLoading, setLoadingState];
};
