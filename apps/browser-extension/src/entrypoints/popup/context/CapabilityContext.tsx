import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { type Capabilities, CapabilityService } from '@/utils/CapabilityService';
import { type CapabilityKey, isCapabilityEnabled } from '@/utils/dist/core/models/webapi';

type CapabilityContextType = {
  isEnabled: (key: CapabilityKey) => boolean;
  isLoaded: boolean;
}

const CapabilityContext = createContext<CapabilityContextType | undefined>(undefined);

/**
 * Serves this account's capabilities to the UI.
 */
export const CapabilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    CapabilityService.getAll().then((stored) => {
      setCapabilities(stored);
      setIsLoaded(true);
    });

    return CapabilityService.watch(setCapabilities);
  }, []);

  const isEnabled = useCallback((key: CapabilityKey): boolean => isCapabilityEnabled(capabilities[key]), [capabilities]);

  const value = useMemo(() => ({ isEnabled, isLoaded }), [isEnabled, isLoaded]);

  return (
    <CapabilityContext.Provider value={value}>
      {children}
    </CapabilityContext.Provider>
  );
};

/**
 * The capability check for this account.
 */
export const useCapabilities = (): CapabilityContextType['isEnabled'] => {
  return useCapabilityContext().isEnabled;
};

/**
 * Renders a page only for accounts the capability is on for.
 * @param root0 - the capability to require and the page to render.
 * @param root0.capability - the capability the page needs.
 * @param root0.children - the page.
 */
export const RequireCapability: React.FC<{ capability: CapabilityKey; children: React.ReactNode }> = ({ capability, children }) => {
  const { isEnabled, isLoaded } = useCapabilityContext();

  /*
   * Nothing is known before the stored capabilities are read, and redirecting on a guess would throw out a
   * legitimate deep link. The popup's loading state covers the moment this takes.
   */
  if (!isLoaded) {
    return null;
  }

  return isEnabled(capability) ? <>{children}</> : <Navigate to="/" replace />;
};

/**
 * The capabilities of this account.
 */
const useCapabilityContext = (): CapabilityContextType => {
  const context = useContext(CapabilityContext);
  if (context === undefined) {
    throw new Error('useCapabilities must be used within a CapabilityProvider');
  }

  return context;
};
