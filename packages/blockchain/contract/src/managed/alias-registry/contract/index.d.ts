import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  local_secret_key(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  claimAlias(context: __compactRuntime.CircuitContext<PS>,
             aliasHash_0: Uint8Array,
             contractAddr_0: string): __compactRuntime.CircuitResults<PS, []>;
  getOwner(context: __compactRuntime.CircuitContext<PS>, aliasHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  getContractAddress(context: __compactRuntime.CircuitContext<PS>,
                     aliasHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, string>;
  releaseAlias(context: __compactRuntime.CircuitContext<PS>,
               aliasHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  claimAlias(context: __compactRuntime.CircuitContext<PS>,
             aliasHash_0: Uint8Array,
             contractAddr_0: string): __compactRuntime.CircuitResults<PS, []>;
  getOwner(context: __compactRuntime.CircuitContext<PS>, aliasHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  getContractAddress(context: __compactRuntime.CircuitContext<PS>,
                     aliasHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, string>;
  releaseAlias(context: __compactRuntime.CircuitContext<PS>,
               aliasHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  ownerCommitment(sk_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  ownerCommitment(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  claimAlias(context: __compactRuntime.CircuitContext<PS>,
             aliasHash_0: Uint8Array,
             contractAddr_0: string): __compactRuntime.CircuitResults<PS, []>;
  getOwner(context: __compactRuntime.CircuitContext<PS>, aliasHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  getContractAddress(context: __compactRuntime.CircuitContext<PS>,
                     aliasHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, string>;
  releaseAlias(context: __compactRuntime.CircuitContext<PS>,
               aliasHash_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  aliasOwners: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  aliasContracts: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): string;
    [Symbol.iterator](): Iterator<[Uint8Array, string]>
  };
  readonly totalClaimCount: bigint;
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
