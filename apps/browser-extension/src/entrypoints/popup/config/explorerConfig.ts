/**
 * Midnight block explorer configuration per network.
 * Maps network IDs to explorer base URLs and address URL patterns.
 *
 * For networks without an explorer (e.g. local/undeployed), the entry is null,
 * and the UI gracefully hides the explorer link.
 */

export interface ExplorerConfig {
  /** Human-readable name of the explorer */
  name: string;
  /** Base URL of the explorer (no trailing slash) */
  baseUrl: string;
  /** URL pattern for looking up an address. Use {address} as placeholder. */
  addressUrl: string;
  /** URL pattern for looking up a transaction. Use {txHash} as placeholder. */
  txUrl: string;
  /** URL pattern for looking up a contract. Use {address} as placeholder. */
  contractUrl: string;
}

const EXPLORER_CONFIG: Record<string, ExplorerConfig | null> = {
  undeployed: null,
  preview: {
    name: 'Nocy Explorer',
    baseUrl: 'https://explorer.nocy.io',
    addressUrl: 'https://explorer.nocy.io/search?q={address}',
    txUrl: 'https://explorer.nocy.io/tx/{txHash}',
    contractUrl: 'https://explorer.nocy.io/search?q={address}',
  },
  preprod: {
    name: 'Nocy Explorer',
    baseUrl: 'https://explorer.nocy.io',
    addressUrl: 'https://explorer.nocy.io/search?q={address}',
    txUrl: 'https://explorer.nocy.io/tx/{txHash}',
    contractUrl: 'https://explorer.nocy.io/search?q={address}',
  },
  mainnet: null,
};

/** Current network ID — matches the Lace wallet networkId. */
const CURRENT_NETWORK = 'undeployed';

/**
 * Get explorer config for the current network.
 * Returns null if no explorer is available.
 */
export function getExplorerConfig(): ExplorerConfig | null {
  return EXPLORER_CONFIG[CURRENT_NETWORK] ?? null;
}

/**
 * Get explorer URL for a wallet/contract address.
 * Returns null if no explorer is available for the current network.
 */
export function getExplorerAddressUrl(address: string): string | null {
  const config = getExplorerConfig();
  if (!config) return null;
  return config.addressUrl.replace('{address}', encodeURIComponent(address));
}

/**
 * Get explorer URL for a transaction hash.
 * Returns null if no explorer is available for the current network.
 */
export function getExplorerTxUrl(txHash: string): string | null {
  const config = getExplorerConfig();
  if (!config) return null;
  return config.txUrl.replace('{txHash}', encodeURIComponent(txHash));
}

/**
 * Get explorer URL for a contract address.
 * Returns null if no explorer is available for the current network.
 */
export function getExplorerContractUrl(address: string): string | null {
  const config = getExplorerConfig();
  if (!config) return null;
  return config.contractUrl.replace('{address}', encodeURIComponent(address));
}
