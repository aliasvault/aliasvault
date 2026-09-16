import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';

import FullScreenLoadingIndicator from '@/components/loading/FullScreenLoadingIndicator';

type LoadingContextType = {
  isLoading: boolean;
  loadingMessage?: string;
  showLoading: (message?: string) => void;
  hideLoading: () => void;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

/**
 * Global loading spinner (the Blazor GlobalLoadingService), rendered as a full screen overlay.
 */
export const LoadingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | undefined>(undefined);

  /**
   * Show the loading spinner with an optional message.
   */
  const showLoading = useCallback((message?: string): void => {
    setIsLoading(true);
    setLoadingMessage(message);
  }, []);

  /**
   * Hide the loading spinner.
   */
  const hideLoading = useCallback((): void => {
    setIsLoading(false);
    setLoadingMessage(undefined);
  }, []);

  const value = useMemo(() => ({ isLoading, loadingMessage, showLoading, hideLoading }), [isLoading, loadingMessage, showLoading, hideLoading]);

  return (
    <LoadingContext.Provider value={value}>
      <FullScreenLoadingIndicator isVisible={isLoading} message={loadingMessage} />
      {children}
    </LoadingContext.Provider>
  );
};

/**
 * Hook to use the global loading state.
 */
export const useLoading = (): LoadingContextType => {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error('useLoading must be used within a LoadingProvider');
  }
  return context;
};
