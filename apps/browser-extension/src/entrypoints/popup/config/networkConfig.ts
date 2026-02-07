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
