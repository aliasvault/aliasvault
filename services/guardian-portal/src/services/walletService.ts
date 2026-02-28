export interface WalletConnection {
  address: string;
  isConnected: boolean;
}

/**
 * Check if Lace wallet is available in the browser.
 * Guardian portal is a regular web page — direct window access, NOT Chrome scripting API.
 */
export function detectLaceWallet(): boolean {
  return !!(window as unknown as Record<string, unknown>).midnight &&
    !!((window as unknown as Record<string, unknown>).midnight as Record<string, unknown>)?.mnLace;
}

/**
 * Connect to Lace wallet via Midnight DApp connector.
 * Lace v4+ API: lace.connect(networkId) + wallet.getShieldedAddresses()
 */
export async function connectWallet(networkId: string): Promise<WalletConnection> {
  const midnight = (window as unknown as Record<string, unknown>).midnight as Record<string, unknown> | undefined;
  const lace = midnight?.mnLace as { connect(networkId: string): Promise<{ getShieldedAddresses(): Promise<string[]> }> } | undefined;

  if (!lace) {
    throw new Error('Lace wallet not detected. Please install the Lace browser extension.');
  }

  const wallet = await lace.connect(networkId);
  const addresses = await wallet.getShieldedAddresses();
  const address = addresses[0];

  if (!address) {
    throw new Error('No shielded address available from wallet.');
  }

  return { address, isConnected: true };
}

export function disconnectWallet(): void {
  // Lace doesn't have a programmatic disconnect — clearing state is sufficient
}
