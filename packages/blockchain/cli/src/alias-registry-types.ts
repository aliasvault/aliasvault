import { AliasRegistry } from '@aliasvault/contract';
import type { AliasRegistryPrivateState } from '@aliasvault/contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

export type { AliasRegistryPrivateState } from '@aliasvault/contract';

export type AliasRegistryCircuits = ProvableCircuitId<AliasRegistry.Contract<AliasRegistryPrivateState>>;

export const AliasRegistryPrivateStateId = 'aliasRegistryPrivateState';

export type AliasRegistryProviders = MidnightProviders<
    AliasRegistryCircuits,
    typeof AliasRegistryPrivateStateId,
    AliasRegistryPrivateState
>;

export type AliasRegistryContract = AliasRegistry.Contract<AliasRegistryPrivateState>;

export type DeployedAliasRegistryContract =
    | DeployedContract<AliasRegistryContract>
    | FoundContract<AliasRegistryContract>;
