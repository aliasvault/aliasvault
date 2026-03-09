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
    address: 'e386083d04bdf1820466c8e1ac395ef06ecc2688fc4816e175bef51cb537f868', // Set after deployment (Story 2.5)
    version: '0.1.0',
  },
  AliasRegistry: {
    address: '', // Set after deployment — singleton global contract for all users
    version: '0.1.0',
  },
};
