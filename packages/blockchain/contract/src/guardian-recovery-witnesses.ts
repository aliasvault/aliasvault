import { type WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { type Ledger } from './managed/guardian-recovery/contract/index.js';

// GuardianRecovery private state — stores the owner's secret key and optional guardian key (witness data).
// Follows the VaultRegistry pattern: WitnessContext<Ledger, PrivateState> → [newPrivateState, returnValue].
export type GuardianRecoveryPrivateState = {
  readonly secretKey: Uint8Array;
  readonly guardianKey: Uint8Array;
};

export const createGuardianRecoveryPrivateState = (
  secretKey: Uint8Array,
  guardianKey?: Uint8Array,
): GuardianRecoveryPrivateState => ({
  secretKey,
  guardianKey: guardianKey ?? new Uint8Array(32),
});

export const guardianRecoveryWitnesses = {
  local_secret_key: ({
    privateState,
  }: WitnessContext<Ledger, GuardianRecoveryPrivateState>): [
    GuardianRecoveryPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],
  local_guardian_key: ({
    privateState,
  }: WitnessContext<Ledger, GuardianRecoveryPrivateState>): [
    GuardianRecoveryPrivateState,
    Uint8Array,
  ] => [privateState, privateState.guardianKey],
};
