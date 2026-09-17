import { type CapabilityKey, isCapabilityEnabled } from '@aliasvault/models/webapi';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import NativeVaultManager from '@/specs/NativeVaultManager';
import emitter from '@/utils/EventEmitter';

/** The resolved capabilities, keyed by capability key. */
type Capabilities = Record<string, string>;

type CapabilityContextType = {
  isEnabled: (key: CapabilityKey) => boolean;
  isLoaded: boolean;
}

const CapabilityContext = createContext<CapabilityContextType | undefined>(undefined);

/**
 * Serves this account's capabilities to the UI. The native sync stores what the server resolved, so they are
 * re-read after every sync, and when the login state changes because a logout clears them.
 */
export const CapabilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoggedIn } = useAuth();
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    /**
     * Read the stored capabilities. An unknown capability is off, so a failed read leaves every gated screen hidden.
     */
    const load = async (): Promise<void> => {
      const stored = await NativeVaultManager.getCapabilities().then(parseCapabilities).catch(() => ({}));
      if (!cancelled) {
        setCapabilities(stored);
        setIsLoaded(true);
      }
    };

    load();
    const subscription = emitter.addListener('vaultSynced', load);

    return (): void => {
      cancelled = true;
      subscription.remove();
    };
  }, [isLoggedIn]);

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
 * The capabilities of this account, with whether they have been read yet.
 */
export const useCapabilityContext = (): CapabilityContextType => {
  const context = useContext(CapabilityContext);
  if (context === undefined) {
    throw new Error('useCapabilities must be used within a CapabilityProvider');
  }

  return context;
};

/**
 * Parse the stored capabilities, reading anything that is not a JSON object as none.
 * @param json - the capabilities as stored natively, or null when no sync stored any yet.
 */
function parseCapabilities(json: string | null): Capabilities {
  if (!json) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Capabilities : {};
  } catch {
    return {};
  }
}
