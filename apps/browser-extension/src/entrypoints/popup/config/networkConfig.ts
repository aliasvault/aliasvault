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
    indexerUrl: 'http://localhost:8088/api/v4/graphql',
    wsIndexerUrl: 'ws://localhost:8088/api/v4/graphql/ws',
    nodeUrl: 'http://localhost:9944',
    proofServerUrl: 'http://localhost:6300',
  },
  preprod: {
    networkId: 'preprod',
    indexerUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    wsIndexerUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'https://rpc.preprod.midnight.network',
    proofServerUrl: 'https://lace-proof-pub.preprod.midnight.network',
  },
  preview: {
    networkId: 'preview',
    indexerUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
    wsIndexerUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'https://rpc.preview.midnight.network',
    proofServerUrl: 'https://lace-proof-pub.preview.midnight.network',
  },
  qanet: {
    networkId: 'qanet',
    indexerUrl: 'https://indexer.qanet.midnight.network/api/v4/graphql',
    wsIndexerUrl: 'wss://indexer.qanet.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'https://rpc.qanet.midnight.network',
    proofServerUrl: 'https://proof.qanet.midnight.network',
  },
  mainnet: {
    networkId: 'mainnet',
    indexerUrl: 'https://indexer.mainnet.midnight.network/api/v4/graphql',
    wsIndexerUrl: 'wss://indexer.mainnet.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'https://rpc.mainnet.midnight.network',
    proofServerUrl: 'https://lace-proof-pub.mainnet.midnight.network',
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
 * Synchronous — returns hardcoded fallback URLs.
 *
 * @throws Error if network ID is not recognized
 */
export function getNetworkConfig(networkId?: string): NetworkConfig {
  const id = (networkId ?? CURRENT_NETWORK) as MidnightNetworkId;
  const config = NETWORK_CONFIGS[id];
  if (!config) {
    throw new Error(`Unknown network ID: "${id}". Valid IDs: ${Object.keys(NETWORK_CONFIGS).join(', ')}`);
  }
  // L2 (6.5b review): allow per-service env overrides for QA and custom devnet flows.
  // Each VITE_* var, when set at build time, replaces the corresponding hardcoded URL.
  const env = import.meta.env;
  const indexerOverride = env.VITE_INDEXER_URL as string | undefined;
  const wsIndexerOverride = env.VITE_WS_INDEXER_URL as string | undefined;
  const nodeOverride = env.VITE_NODE_URL as string | undefined;
  const proofOverride = env.VITE_PROOF_SERVER_URL as string | undefined;
  if (indexerOverride || wsIndexerOverride || nodeOverride || proofOverride) {
    return {
      ...config,
      indexerUrl: indexerOverride || config.indexerUrl,
      wsIndexerUrl: wsIndexerOverride || config.wsIndexerUrl,
      nodeUrl: nodeOverride || config.nodeUrl,
      proofServerUrl: proofOverride || config.proofServerUrl,
    };
  }
  return config;
}

import { getWalletState } from '@/services/providers/WalletState';

/**
 * Get network config preferring wallet-provided service URLs over hardcoded fallbacks.
 * Async — reads WalletState.serviceConfig from session storage.
 * Use this in async callers (contract services, provider setup).
 *
 * Note: `getWalletState` is imported statically. MV3 service workers forbid dynamic
 * import() — and WalletState only depends on wxt/utils/storage, so there is no cycle.
 */
export async function getWalletNetworkConfig(networkId?: string): Promise<NetworkConfig> {
  const fallback = getNetworkConfig(networkId);

  const walletState = await getWalletState();
  const sc = walletState?.serviceConfig;

  if (!sc) {
    return fallback;
  }

  // M1 (6.5b review): detect silent fallbacks and network mismatch so we don't
  // ship proofs to the wrong server when Lace stops emitting the deprecated field.
  // Full fix is migrating to connectedAPI.getProvingProvider() — TODO(6.5b M1).
  if (!sc.proverServerUri) {
    console.warn(
      `[networkConfig] Wallet did not provide proverServerUri; falling back to hardcoded ${fallback.proofServerUrl} ` +
      `for network="${fallback.networkId}". proverServerUri is @deprecated in dapp-connector-api@4.0.1 — migrate to getProvingProvider() (6.5b M1).`
    );
  }
  if (walletState?.networkId && walletState.networkId !== fallback.networkId) {
    console.warn(
      `[networkConfig] Wallet networkId="${walletState.networkId}" does not match requested network="${fallback.networkId}". ` +
      `The hardcoded fallback URLs are for "${fallback.networkId}" and may not reach the wallet's actual chain.`
    );
  }

  return {
    ...fallback,
    indexerUrl: sc.indexerUri || fallback.indexerUrl,
    wsIndexerUrl: sc.indexerWsUri || fallback.wsIndexerUrl,
    proofServerUrl: sc.proverServerUri || fallback.proofServerUrl,
  };
}
