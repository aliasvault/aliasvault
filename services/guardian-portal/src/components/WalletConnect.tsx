import { useWallet } from '../context/WalletContext';
import { CURRENT_NETWORK } from '../config/networkConfig';

interface WalletConnectProps {
  networkId?: string;
}

export function WalletConnect({ networkId }: WalletConnectProps = {}) {
  const { isConnected, address, isConnecting, error, isWalletDetected, connect, disconnect } = useWallet();

  if (!isWalletDetected) {
    return (
      <div data-testid="wallet-not-detected">
        <p>Lace wallet not detected — please install the Lace browser extension.</p>
      </div>
    );
  }

  if (isConnected && address) {
    return (
      <div data-testid="wallet-connected">
        <p>Connected: {address.slice(0, 10)}...{address.slice(-6)}</p>
        <button onClick={disconnect}>Disconnect</button>
      </div>
    );
  }

  return (
    <div data-testid="wallet-connect">
      <button onClick={() => connect(networkId ?? CURRENT_NETWORK)} disabled={isConnecting}>
        {isConnecting ? 'Connecting...' : 'Connect Lace Wallet'}
      </button>
      {error && <p data-testid="wallet-error">{error}</p>}
    </div>
  );
}
