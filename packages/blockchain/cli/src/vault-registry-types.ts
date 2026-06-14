import { VaultRegistry } from '@aliasvault/contract';
import type { VaultRegistryPrivateState } from '@aliasvault/contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

export type { VaultRegistryPrivateState } from '@aliasvault/contract';

export type VaultRegistryCircuits = ProvableCircuitId<VaultRegistry.Contract<VaultRegistryPrivateState>>;

export const VaultRegistryPrivateStateId = 'vaultRegistryPrivateState';

export type VaultRegistryProviders = MidnightProviders<
    VaultRegistryCircuits,
    typeof VaultRegistryPrivateStateId,
    VaultRegistryPrivateState
>;

export type VaultRegistryContract = VaultRegistry.Contract<VaultRegistryPrivateState>;

export type DeployedVaultRegistryContract =
    | DeployedContract<VaultRegistryContract>
    | FoundContract<VaultRegistryContract>;
