import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  local_secret_key(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  local_guardian_key(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  initialize(context: __compactRuntime.CircuitContext<PS>,
             ownerCom_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  addGuardian(context: __compactRuntime.CircuitContext<PS>,
              guardianCom_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  removeGuardian(context: __compactRuntime.CircuitContext<PS>,
                 guardianCom_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  storeSharesCidHash(context: __compactRuntime.CircuitContext<PS>,
                     cidHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  initiateRecovery(context: __compactRuntime.CircuitContext<PS>,
                   currentTime_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  approveRecovery(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  claimRecovery(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancelRecovery(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  initialize(context: __compactRuntime.CircuitContext<PS>,
             ownerCom_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  addGuardian(context: __compactRuntime.CircuitContext<PS>,
              guardianCom_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  removeGuardian(context: __compactRuntime.CircuitContext<PS>,
                 guardianCom_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  storeSharesCidHash(context: __compactRuntime.CircuitContext<PS>,
                     cidHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  initiateRecovery(context: __compactRuntime.CircuitContext<PS>,
                   currentTime_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  approveRecovery(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  claimRecovery(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancelRecovery(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  ownerCommitment(sk_0: Uint8Array): Uint8Array;
  guardianCommitment(gk_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  ownerCommitment(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  guardianCommitment(context: __compactRuntime.CircuitContext<PS>,
                     gk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  initialize(context: __compactRuntime.CircuitContext<PS>,
             ownerCom_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  addGuardian(context: __compactRuntime.CircuitContext<PS>,
              guardianCom_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  removeGuardian(context: __compactRuntime.CircuitContext<PS>,
                 guardianCom_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  storeSharesCidHash(context: __compactRuntime.CircuitContext<PS>,
                     cidHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  initiateRecovery(context: __compactRuntime.CircuitContext<PS>,
                   currentTime_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  approveRecovery(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  claimRecovery(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  cancelRecovery(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly owner: Uint8Array;
  guardians: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly guardianCount: bigint;
  readonly recoveryInitiatedAt: bigint;
  approvedGuardians: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly sharesCidHash: Uint8Array;
  readonly recoveryComplete: boolean;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
