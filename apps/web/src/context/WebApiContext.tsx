import { WebApiService } from '@aliasvault/client/api/WebApiService';
import React, { createContext, useContext, useState } from 'react';

const WebApiContext = createContext<WebApiService | null>(null);

/**
 * WebApiProvider to provide the WebApiService to the app that components can use.
 */
export const WebApiProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [webApiService] = useState<WebApiService>(() => new WebApiService());

  return (
    <WebApiContext.Provider value={webApiService}>
      {children}
    </WebApiContext.Provider>
  );
};

/**
 * Hook to use the WebApiService.
 */
export const useWebApi = (): WebApiService => {
  const context = useContext(WebApiContext);
  if (!context) {
    throw new Error('useWebApi must be used within a WebApiProvider');
  }
  return context;
};
