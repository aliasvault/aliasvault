import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import { sendMessage } from 'webext-bridge/popup';

import { storage } from '#imports';
import { clearWalletState } from '@/services/providers/WalletState';

/**
 * Wallet state persisted in extension storage.
 */
export interface WalletState {
  address: string;
  coinPublicKey: string;
  shieldedAddress: string;
}

/**
 * Result from a successful signature challenge.
 *
 * Signature is always a real cryptographic signature from Lace's `signData` —
 * the previous `connection-proof` fallback was removed 2026-04-18 per 6.5b review M4.
 */
export interface SignatureResult {
  signature: string;
  publicKey: string;
  challenge: string;
}

type WalletContextType = {
  isConnected: boolean;
  isConnecting: boolean;
  isSigning: boolean;
  isVerified: boolean;
  walletState: WalletState | null;
  signatureResult: SignatureResult | null;
  error: string | null;
  detectWallet: () => Promise<boolean>;
  connectWallet: () => Promise<void>;
  signChallenge: () => Promise<boolean>;
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
  const [isSigning, setIsSigning] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [walletState, setWalletState] = useState<WalletState | null>(null);
  const [signatureResult, setSignatureResult] = useState<SignatureResult | null>(null);
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
      const result = await sendMessage('DETECT_LACE_WALLET', {}, 'background') as unknown as { success: boolean; data?: { detected: boolean } };
      if (!result?.success) {
        return false;
      }
      return result.data?.detected ?? false;
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
      const result = await sendMessage('CONNECT_LACE_WALLET', {}, 'background') as unknown as { success: boolean; data?: WalletState; error?: string };

      if (!result?.success) {
        const errorMsg = result?.error ?? 'Failed to connect wallet';
        setError(errorMsg);
        return;
      }

      const state = result.data as WalletState;
      if (!state?.address) {
        setError('No wallet address returned');
        return;
      }

      setWalletState(state);
      setIsConnected(true);

      // Persist to extension storage
      await storage.setItem(WALLET_STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(message);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  /**
   * Generate a unique challenge message and request wallet signature.
   * Returns true if signing succeeded.
   */
  const signChallenge = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsSigning(true);

    try {
      // Generate a crypto-random challenge
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      const challenge = `AliasVault-Auth:${nonce}:${Date.now()}`;

      const result = await sendMessage('SIGN_CHALLENGE', { challenge }, 'background') as unknown as { success: boolean; data?: SignatureResult; error?: string };

      if (!result?.success) {
        setError(result?.error ?? 'Signing failed');
        return false;
      }

      const sig = result.data as SignatureResult;
      if (!sig?.signature) {
        setError('No signature returned from wallet');
        return false;
      }

      setSignatureResult(sig);
      setIsVerified(true);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signing failed';
      setError(message);
      return false;
    } finally {
      setIsSigning(false);
    }
  }, []);

  /**
   * Disconnect wallet and clear persisted state.
   *
   * Clears BOTH stores so the popup UI and the background proxy providers
   * agree the wallet is disconnected:
   *   - local:walletState   → popup-owned display state
   *   - session:laceWalletState → background-owned auth state consumed by
   *     LaceWalletProxy / LaceMidnightProxy. Without this, contract ops
   *     would still execute with stale keys after the user clicks disconnect.
   */
  const disconnectWallet = useCallback((): void => {
    setWalletState(null);
    setIsConnected(false);
    setIsVerified(false);
    setSignatureResult(null);
    setError(null);
    storage.removeItem(WALLET_STORAGE_KEY);
    // Fire-and-forget: we don't block UI on session clear, but we do want
    // the background state gone before any subsequent contract call.
    void clearWalletState();
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
    isSigning,
    isVerified,
    walletState,
    signatureResult,
    error,
    detectWallet,
    connectWallet,
    signChallenge,
    disconnectWallet,
    clearError,
  }), [isConnected, isConnecting, isSigning, isVerified, walletState, signatureResult, error, detectWallet, connectWallet, signChallenge, disconnectWallet, clearError]);

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
