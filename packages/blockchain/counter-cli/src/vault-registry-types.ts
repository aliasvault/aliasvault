import { VaultRegistry } from '@midnight-ntwrk/counter-contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ImpureCircuitId } from '@midnight-ntwrk/compact-js';

export type VaultRegistryPrivateState = Record<string, never>;

export type VaultRegistryCircuits = ImpureCircuitId<VaultRegistry.Contract<VaultRegistryPrivateState>>;

export const VaultRegistryPrivateStateId = 'vaultRegistryPrivateState';

export type VaultRegistryProviders = MidnightProviders<VaultRegistryCircuits, typeof VaultRegistryPrivateStateId, VaultRegistryPrivateState>;

export type VaultRegistryContract = VaultRegistry.Contract<VaultRegistryPrivateState>;

export type DeployedVaultRegistryContract = DeployedContract<VaultRegistryContract> | FoundContract<VaultRegistryContract>;
