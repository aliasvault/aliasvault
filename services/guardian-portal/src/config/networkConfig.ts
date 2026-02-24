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
    proofServerUrl: 'https://proof.preprod.midnight.network',
  },
  preview: {
    networkId: 'preview',
    indexerUrl: 'https://indexer.preview.midnight.network/api/v3/graphql',
    wsIndexerUrl: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
    nodeUrl: 'https://rpc.preview.midnight.network',
    proofServerUrl: 'https://proof.preview.midnight.network',
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

export const CURRENT_NETWORK: MidnightNetworkId = 'undeployed';

export function getNetworkConfig(networkId?: string): NetworkConfig {
  const id = (networkId ?? CURRENT_NETWORK) as MidnightNetworkId;
  const config = NETWORK_CONFIGS[id];
  if (!config) {
    throw new Error(`Unknown network ID: "${networkId}". Valid IDs: ${Object.keys(NETWORK_CONFIGS).join(', ')}`);
  }
  return config;
}
