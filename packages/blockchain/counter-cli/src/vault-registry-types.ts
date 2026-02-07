import { VaultRegistry } from '@aliasvault/contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ImpureCircuitId } from '@midnight-ntwrk/compact-js';

// Mirrors VaultRegistryPrivateState in contract/src/witnesses.ts.
// After next `npm run build` in contract/, import from @aliasvault/contract instead.
export type VaultRegistryPrivateState = Record<string, never>;

export type VaultRegistryCircuits = ImpureCircuitId<VaultRegistry.Contract<VaultRegistryPrivateState>>;

export const VaultRegistryPrivateStateId = 'vaultRegistryPrivateState';

export type VaultRegistryProviders = MidnightProviders<VaultRegistryCircuits, typeof VaultRegistryPrivateStateId, VaultRegistryPrivateState>;

export type VaultRegistryContract = VaultRegistry.Contract<VaultRegistryPrivateState>;

export type DeployedVaultRegistryContract = DeployedContract<VaultRegistryContract> | FoundContract<VaultRegistryContract>;
