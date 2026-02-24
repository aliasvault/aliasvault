import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { connectWallet as connectWalletService, disconnectWallet as disconnectWalletService, detectLaceWallet } from '../services/walletService';

interface WalletState {
  isConnected: boolean;
  address: string | null;
  isConnecting: boolean;
  error: string | null;
  isWalletDetected: boolean;
  connect: (networkId: string) => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState | null>(null);

const WALLET_DETECT_INTERVAL_MS = 500;
const WALLET_DETECT_TIMEOUT_MS = 5000;

export function WalletProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWalletDetected, setIsWalletDetected] = useState(() => detectLaceWallet());

  useEffect(() => {
    if (isWalletDetected) return;

    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += WALLET_DETECT_INTERVAL_MS;
      if (detectLaceWallet()) {
        setIsWalletDetected(true);
        clearInterval(interval);
      } else if (elapsed >= WALLET_DETECT_TIMEOUT_MS) {
        clearInterval(interval);
      }
    }, WALLET_DETECT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isWalletDetected]);

  const connect = useCallback(async (networkId: string) => {
    setIsConnecting(true);
    setError(null);
    try {
      const result = await connectWalletService(networkId);
      setAddress(result.address);
      setIsConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
      setIsConnected(false);
      setAddress(null);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectWalletService();
    setIsConnected(false);
    setAddress(null);
    setError(null);
  }, []);

  return (
    <WalletContext.Provider value={{ isConnected, address, isConnecting, error, isWalletDetected, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return ctx;
}
