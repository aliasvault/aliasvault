/**
 * Midnight network configuration — single source of truth.
 * All wallet connection, explorer, and service code should reference this file
 * instead of hardcoding network IDs or endpoint URLs.
 *
 * Ported from services/guardian-portal/src/config/networkConfig.ts
 */

/**
 * Supported Midnight network IDs.
 * Must match the Lace wallet's expected networkId values.
 */
export type MidnightNetworkId = 'mainnet' | 'preprod' | 'preview' | 'qanet' | 'undeployed';

export interface NetworkConfig {
  networkId: MidnightNetworkId;
  indexerUrl: string;
  wsIndexerUrl: string;
  nodeUrl: string;
  proofServerUrl: string;
}

const NETWORK_CONFIGS: Record<MidnightNetworkId, NetworkConfig> = {
  undeployed: {
    networkId: 'undeployed',
    indexerUrl: 'http://localhost:8088/api/v3/graphql',
    wsIndexerUrl: 'ws://localhost:8088/api/v3/graphql/ws',
    nodeUrl: 'http://localhost:9944',
    proofServerUrl: 'http://localhost:6300',
  },
  preprod: {
    networkId: 'preprod',
    indexerUrl: 'https://indexer.preprod.midnight.network/api/v3/graphql',
    wsIndexerUrl: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
    nodeUrl: 'https://rpc.preprod.midnight.network',
    proofServerUrl: 'https://lace-proof-pub.preprod.midnight.network',
  },
  preview: {
    networkId: 'preview',
    indexerUrl: 'https://indexer.preview.midnight.network/api/v3/graphql',
    wsIndexerUrl: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
    nodeUrl: 'https://rpc.preview.midnight.network',
    proofServerUrl: 'https://lace-proof-pub.preview.midnight.network',
  },
  qanet: {
    networkId: 'qanet',
    indexerUrl: 'https://indexer.qanet.midnight.network/api/v3/graphql',
    wsIndexerUrl: 'wss://indexer.qanet.midnight.network/api/v3/graphql/ws',
    nodeUrl: 'https://rpc.qanet.midnight.network',
    proofServerUrl: 'https://proof.qanet.midnight.network',
  },
  mainnet: {
    networkId: 'mainnet',
    indexerUrl: 'https://indexer.midnight.network/api/v3/graphql',
    wsIndexerUrl: 'wss://indexer.midnight.network/api/v3/graphql/ws',
    nodeUrl: 'https://rpc.midnight.network',
    proofServerUrl: 'https://proof.midnight.network',
  },
};

/**
 * Current active network.
 * Resolved from VITE_MIDNIGHT_NETWORK env var at build time, defaults to 'undeployed'.
 */
export const CURRENT_NETWORK: MidnightNetworkId =
  (import.meta.env.VITE_MIDNIGHT_NETWORK as MidnightNetworkId) || 'undeployed';

/**
 * Get the network configuration for a given network ID.
 * Defaults to CURRENT_NETWORK if no ID provided.
 *
 * @throws Error if network ID is not recognized
 */
export function getNetworkConfig(networkId?: string): NetworkConfig {
  const id = (networkId ?? CURRENT_NETWORK) as MidnightNetworkId;
  const config = NETWORK_CONFIGS[id];
  if (!config) {
    throw new Error(`Unknown network ID: "${id}". Valid IDs: ${Object.keys(NETWORK_CONFIGS).join(', ')}`);
  }
  return config;
}
