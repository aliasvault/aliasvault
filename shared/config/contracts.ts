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
  /** Network the contract was deployed to. Prevents silent cross-network overwrites. */
  network: 'local' | 'preview' | 'preprod' | 'mainnet';
}

/**
 * All deployed contract configurations.
 * Updated by deployment scripts (Story 2.5) after contract deployment.
 */
export const CONTRACTS: Record<string, ContractConfig> = {
  VaultRegistry: {
    address: '9cc11ce659c11068a29fd124ff3e7ab50ee0ada547b08e7f4561fee0787c22ac',
    version: '0.1.0',
    network: 'preprod',
  },
  AliasRegistry: {
    address: '645ebbebf9c30ef2ff5e97cf7f161d17a9c3804bf9b5be6ae367f0ac71f451c7',
    version: '0.1.0',
    network: 'preprod',
  },
};
