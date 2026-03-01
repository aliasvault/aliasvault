/**
 * Lace v4+ DApp connector API types.
 * @midnight-ntwrk/dapp-connector-api is not in our dependency tree,
 * so we define local interfaces matching the actual Lace v4 shape.
 * Reference: bboard BrowserDeployedBoardManager.ts lines 40, 223-266
 * Cross-referenced: MeshJS walletController.ts, midnight-bank connectToWallet.ts
 */
export interface ServiceConfiguration {
  proverServerUri: string;
  indexerUri: string;
  indexerWsUri: string;
}

export interface ShieldedAddresses {
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
}

export interface ConnectedAPI {
  getShieldedAddresses(): Promise<ShieldedAddresses>;
  getConfiguration(): Promise<ServiceConfiguration>;
  balanceUnsealedTransaction(hexTx: string): Promise<{ tx: string }>;
  submitTransaction(hexTx: string): Promise<void>;
  getConnectionStatus(): Promise<unknown>;
}

export interface WalletConnection {
  address: string;
  isConnected: boolean;
  connectedAPI: ConnectedAPI;
  shieldedAddresses: ShieldedAddresses;
  serviceConfig: ServiceConfiguration;
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
 * Lace v4+ API: lace.connect(networkId) → ConnectedAPI
 *
 * Retains full ConnectedAPI for provider wiring:
 * - connectedAPI.balanceUnsealedTransaction() → walletProvider.balanceTx()
 * - connectedAPI.submitTransaction() → midnightProvider.submitTx()
 * - connectedAPI.getConfiguration() → proverServerUri, indexerUri, indexerWsUri
 * - connectedAPI.getShieldedAddresses() → coinPublicKey, encryptionPublicKey
 *
 * Reference: bboard BrowserDeployedBoardManager.ts initializeProviders()
 */
export async function connectWallet(networkId: string): Promise<WalletConnection> {
  const midnight = (window as unknown as Record<string, unknown>).midnight as Record<string, unknown> | undefined;
  const lace = midnight?.mnLace as { connect(networkId: string): Promise<ConnectedAPI> } | undefined;

  if (!lace) {
    throw new Error('Lace wallet not detected. Please install the Lace browser extension.');
  }

  const connectedAPI = await lace.connect(networkId);
  const shieldedAddresses = await connectedAPI.getShieldedAddresses();
  const serviceConfig = await connectedAPI.getConfiguration();

  const address = shieldedAddresses.shieldedCoinPublicKey;

  if (!address) {
    throw new Error('No shielded address available from wallet.');
  }

  return {
    address,
    isConnected: true,
    connectedAPI,
    shieldedAddresses,
    serviceConfig,
  };
}

export function disconnectWallet(): void {
  // Lace doesn't have a programmatic disconnect — clearing state is sufficient
}
