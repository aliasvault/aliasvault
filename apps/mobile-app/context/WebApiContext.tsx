import React, { createContext, useContext, useEffect, useState } from 'react';

import { WebApiService } from '@/utils/WebApiService';

const WebApiContext = createContext<WebApiService | null>(null);

/**
 * WebApiProvider to provide the WebApiService to the app that components can use.
 */
export const WebApiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [webApiService, setWebApiService] = useState<WebApiService | null>(null);

  /**
   * Initialize WebApiService
   */
  useEffect(() : void => {
    const service = new WebApiService();
    setWebApiService(service);
  }, []);

  if (!webApiService) {
    return null;
  }

  return (
    <WebApiContext.Provider value={webApiService}>
      {children}
    </WebApiContext.Provider>
  );
};

/**
 * Hook to use the WebApiService
 */
export const useWebApi = () : WebApiService => {
  const context = useContext(WebApiContext);
  if (!context) {
    throw new Error('useWebApi must be used within a WebApiProvider');
  }
  return context;
};
