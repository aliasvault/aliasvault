/**
 * WalletService manages wallet-based authentication state.
 * Replaces the legacy SRP authentication flow with Midnight wallet signing.
 *
 * Auth flow:
 *   1. User connects Lace wallet → gets wallet address
 *   2. User signs challenge → proves ownership
 *   3. Auth state is established based on verified wallet identity
 *
 * This service is used outside React components. For React components,
 * use the useWallet() hook from WalletContext.tsx instead.
 */

export interface WalletAuthState {
  /** Whether the wallet is connected */
  isConnected: boolean;
  /** Whether the wallet signature has been verified */
  isVerified: boolean;
  /** The connected wallet address (shielded address) */
  walletAddress: string | null;
  /** Network ID the wallet is connected to */
  networkId: string;
}

/** Default network for local development */
const DEFAULT_NETWORK_ID = 'undeployed';

/**
 * Get the current network ID for wallet connections.
 */
export function getNetworkId(): string {
  return DEFAULT_NETWORK_ID;
}

/**
 * Create an initial (unauthenticated) wallet auth state.
 */
export function createInitialAuthState(): WalletAuthState {
  return {
    isConnected: false,
    isVerified: false,
    walletAddress: null,
    networkId: getNetworkId(),
  };
}

/**
 * Create an authenticated wallet auth state from a verified wallet connection.
 */
export function createAuthenticatedState(walletAddress: string): WalletAuthState {
  return {
    isConnected: true,
    isVerified: true,
    walletAddress,
    networkId: getNetworkId(),
  };
}

/**
 * Validate that a wallet auth state represents a fully authenticated user.
 * Returns true if the wallet is connected AND the signature challenge is verified.
 */
export function isAuthenticated(state: WalletAuthState): boolean {
  return state.isConnected && state.isVerified && state.walletAddress !== null;
}
