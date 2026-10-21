import { type Capabilities, CapabilityService } from '@aliasvault/client/api/CapabilityService';
import { type CapabilityKey, isCapabilityEnabled } from '@aliasvault/models/webapi';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

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
 * The capabilities of this account.
 */
const useCapabilityContext = (): CapabilityContextType => {
  const context = useContext(CapabilityContext);
  if (context === undefined) {
    throw new Error('useCapabilities must be used within a CapabilityProvider');
  }

  return context;
};
