import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  registerVault(context: __compactRuntime.CircuitContext<PS>,
                walletAddressHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  isRegistered(context: __compactRuntime.CircuitContext<PS>,
               walletAddressHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, boolean>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  registerVault(context: __compactRuntime.CircuitContext<PS>,
                walletAddressHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
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
