import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  local_secret_key(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  registerVault(context: __compactRuntime.CircuitContext<PS>,
                walletAddressHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  updateVault(context: __compactRuntime.CircuitContext<PS>,
              newCidHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  isRegistered(context: __compactRuntime.CircuitContext<PS>,
               walletAddressHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
}

export type PureCircuits = {
  ownerCommitment(sk_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  ownerCommitment(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  registerVault(context: __compactRuntime.CircuitContext<PS>,
                walletAddressHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  updateVault(context: __compactRuntime.CircuitContext<PS>,
              newCidHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  isRegistered(context: __compactRuntime.CircuitContext<PS>,
               walletAddressHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
}

export type Ledger = {
  registrations: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly totalVaults: bigint;
  readonly owner: Uint8Array;
  readonly vaultCidHash: Uint8Array;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
