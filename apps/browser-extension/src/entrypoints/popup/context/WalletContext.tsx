import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import { sendMessage } from 'webext-bridge/popup';

import { storage } from '#imports';

/**
 * Wallet state persisted in extension storage.
 */
export interface WalletState {
  address: string;
  coinPublicKey: string;
  encryptionPublicKey: string;
}

type WalletContextType = {
  isConnected: boolean;
  isConnecting: boolean;
  walletState: WalletState | null;
  error: string | null;
  detectWallet: () => Promise<boolean>;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  clearError: () => void;
};

const WalletContext = createContext<WalletContextType | undefined>(undefined);

const WALLET_STORAGE_KEY = 'local:walletState';

/**
 * WalletProvider manages Lace wallet connection state.
 * Persists wallet address across browser sessions via extension storage.
 */
export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletState, setWalletState] = useState<WalletState | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Restore wallet state from extension storage on mount.
   */
  useEffect(() => {
    const restoreWalletState = async (): Promise<void> => {
      try {
        const stored = await storage.getItem(WALLET_STORAGE_KEY) as string | null;
        if (stored) {
          const state = JSON.parse(stored) as WalletState;
          setWalletState(state);
          setIsConnected(true);
        }
      } catch {
        // Ignore parse errors from corrupted storage
      }
    };
    restoreWalletState();
  }, []);

  /**
   * Detect whether Lace wallet is available in the active tab.
   */
  const detectWallet = useCallback(async (): Promise<boolean> => {
    try {
      const result = await sendMessage('DETECT_LACE_WALLET', {}, 'background');
      return (result as { detected: boolean })?.detected ?? false;
    } catch {
      return false;
    }
  }, []);

  /**
   * Connect to Lace wallet via the background script.
   * Triggers the Lace authorization popup in the active tab.
   */
  const connectWallet = useCallback(async (): Promise<void> => {
    setError(null);
    setIsConnecting(true);

    try {
      const result = await sendMessage('CONNECT_LACE_WALLET', {}, 'background');
      const state = result as WalletState;

      if (!state?.address) {
        throw new Error('No wallet address returned');
      }

      setWalletState(state);
      setIsConnected(true);

      // Persist to extension storage
      await storage.setItem(WALLET_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(message);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  /**
   * Disconnect wallet and clear persisted state.
   */
  const disconnectWallet = useCallback((): void => {
    setWalletState(null);
    setIsConnected(false);
    setError(null);
    storage.removeItem(WALLET_STORAGE_KEY);
  }, []);

  /**
   * Clear the current error.
   */
  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  const contextValue = useMemo(() => ({
    isConnected,
    isConnecting,
    walletState,
    error,
    detectWallet,
    connectWallet,
    disconnectWallet,
    clearError,
  }), [isConnected, isConnecting, walletState, error, detectWallet, connectWallet, disconnectWallet, clearError]);

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  );
};

/**
 * Hook to access wallet context.
 */
export const useWallet = (): WalletContextType => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};
