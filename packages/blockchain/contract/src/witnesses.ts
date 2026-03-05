// This file is part of midnightntwrk/example-counter.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { type WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { type Ledger } from './managed/vault-registry/contract/index.js';

// This is how we type an empty object.
export type CounterPrivateState = {
  privateCounter: number;
};

// VaultRegistry private state — stores the owner's secret key and optional backup key (witness data).
// The actual vault CID is application-layer data managed by the API (too large for Bytes<32>).
// Follows the bboard pattern: WitnessContext<Ledger, PrivateState> → [newPrivateState, returnValue].
export type VaultRegistryPrivateState = {
  readonly secretKey: Uint8Array;
  readonly backupKey: Uint8Array;
  readonly relayKey: Uint8Array;
};

export const createVaultRegistryPrivateState = (
  secretKey: Uint8Array,
  backupKey?: Uint8Array,
  relayKey?: Uint8Array,
): VaultRegistryPrivateState => ({
  secretKey,
  backupKey: backupKey ?? new Uint8Array(32),
  relayKey: relayKey ?? new Uint8Array(32),
});

// Counter has no witnesses — empty object required by Contract constructor.
export const witnesses = {};

export const vaultRegistryWitnesses = {
  local_secret_key: ({
    privateState,
  }: WitnessContext<Ledger, VaultRegistryPrivateState>): [
    VaultRegistryPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],
  local_backup_key: ({
    privateState,
  }: WitnessContext<Ledger, VaultRegistryPrivateState>): [
    VaultRegistryPrivateState,
    Uint8Array,
  ] => [privateState, privateState.backupKey],
  local_relay_key: ({
    privateState,
  }: WitnessContext<Ledger, VaultRegistryPrivateState>): [
    VaultRegistryPrivateState,
    Uint8Array,
  ] => [privateState, privateState.relayKey],
};

