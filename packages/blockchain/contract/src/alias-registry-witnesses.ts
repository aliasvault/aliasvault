import { type WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { type Ledger } from './managed/alias-registry/contract/index.js';

export type AliasRegistryPrivateState = {
  readonly secretKey: Uint8Array;
};

export const createAliasRegistryPrivateState = (
  secretKey: Uint8Array,
): AliasRegistryPrivateState => ({
  secretKey,
});

export const aliasRegistryWitnesses = {
  local_secret_key: ({
    privateState,
  }: WitnessContext<Ledger, AliasRegistryPrivateState>): [
    AliasRegistryPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],
};
