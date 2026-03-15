/**
 * Contract address management — single source of truth.
 * All apps import contract addresses from here (ADR-004 / project-context.md Rule 4).
 *
 * NEVER hardcode contract addresses as string literals in app code.
 * Import from this file exclusively.
 */

export interface ContractConfig {
  /** Deployed contract address (hex string). Empty until deployed. */
  address: string;
  /** Semantic version of the deployed contract. */
  version: string;
}

/**
 * All deployed contract configurations.
 * Updated by deployment scripts (Story 2.5) after contract deployment.
 */
export const CONTRACTS: Record<string, ContractConfig> = {
  VaultRegistry: {
    address: 'd390bc9c51eb82689cf55b4c20e9fa914eec81ce468f7147bcc21db0c2f3b1ac', // Local deployment address — will change at preprod
    version: '0.1.0',
  },
  AliasRegistry: {
    address: '9ce46d1d1c92dc41f4d0a4aaf3085b715e89ee7dc0dc8f43af060849eb5f14c0', // Set after deployment — singleton global contract for all users
    version: '0.1.0',
  },
};
