import { GuardianRecovery } from '@aliasvault/contract';
import type { GuardianRecoveryPrivateState } from '@aliasvault/contract';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';

export type { GuardianRecoveryPrivateState } from '@aliasvault/contract';

export type GuardianRecoveryCircuits = ProvableCircuitId<GuardianRecovery.Contract<GuardianRecoveryPrivateState>>;

export const GuardianRecoveryPrivateStateId = 'guardianRecoveryPrivateState';

export type GuardianRecoveryProviders = MidnightProviders<
    GuardianRecoveryCircuits,
    typeof GuardianRecoveryPrivateStateId,
    GuardianRecoveryPrivateState
>;

export type GuardianRecoveryContract = GuardianRecovery.Contract<GuardianRecoveryPrivateState>;

export type DeployedGuardianRecoveryContract =
    | DeployedContract<GuardianRecoveryContract>
    | FoundContract<GuardianRecoveryContract>;
