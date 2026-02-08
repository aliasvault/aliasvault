/**
 * Midnight network configuration — single source of truth.
 * All wallet connection and explorer code should reference this file
 * instead of hardcoding network IDs.
 */

/**
 * Supported Midnight network IDs.
 * Must match the Lace wallet's expected networkId values.
 */
export type MidnightNetworkId = 'mainnet' | 'preprod' | 'preview' | 'qanet' | 'undeployed';

/**
 * Current active network.
 * Change this when targeting different environments.
 */
export const CURRENT_NETWORK: MidnightNetworkId = 'undeployed';

/**
 * Midnight indexer GraphQL endpoint.
 * Used to query contract state from the public data provider.
 */
export const INDEXER_URL = 'http://localhost:8088/api/v3/graphql';

/**
 * Midnight node RPC endpoint.
 */
export const NODE_URL = 'http://localhost:9944';

/**
 * Midnight proof server endpoint.
 * Used for ZK proof generation when Lace proving provider is unavailable.
 */
export const PROOF_SERVER_URL = 'http://localhost:6300';
