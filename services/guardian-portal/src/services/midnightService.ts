import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
  GuardianRecovery,
  createGuardianRecoveryPrivateState,
  guardianRecoveryWitnesses,
} from '@aliasvault/contract';
import type { NetworkConfig } from '../config/networkConfig';

/** Threshold is hardcoded to 2 in the Compact contract (claimRecovery circuit). */
export const GUARDIAN_THRESHOLD = 2;

export interface GuardianRecoveryState {
  owner: Uint8Array;
  guardianCount: bigint;
  recoveryInitiatedAt: bigint;
  sharesCidHash: Uint8Array;
  recoveryComplete: boolean;
  approvalCount: number;
}

/**
 * Build the compiled contract descriptor for browser context.
 * Unlike CLI (which adds withCompiledFileAssets for filesystem ZK configs),
 * the browser relies on the proof server for proving — no file assets needed.
 */
const guardianRecoveryCompiledContract = CompiledContract.make('guardian-recovery', GuardianRecovery.Contract).pipe(
  CompiledContract.withWitnesses(guardianRecoveryWitnesses),
);

export type ContractHandle = Awaited<ReturnType<typeof joinContract>>;

/**
 * Join an existing GuardianRecovery contract instance as a guardian.
 * Guardian passes undefined for secretKey (not the owner), guardianKey for witness.
 */
export async function joinContract(
  contractAddress: string,
  guardianKey: Uint8Array,
  config: NetworkConfig,
) {
  const providers = {
    proofProvider: httpClientProofProvider(config.proofServerUrl),
    publicDataProvider: indexerPublicDataProvider(config.indexerUrl, config.wsIndexerUrl),
  };

  const contract = await findDeployedContract(providers, {
    contractAddress,
    compiledContract: guardianRecoveryCompiledContract,
    privateStateId: 'guardianRecoveryPrivateState',
    initialPrivateState: createGuardianRecoveryPrivateState(
      new Uint8Array(32), // placeholder for secretKey (guardian doesn't have owner's key)
      guardianKey,
    ),
  });

  return contract;
}

/**
 * Read ledger state from the contract handle.
 */
export function getContractState(handle: ContractHandle): GuardianRecoveryState {
  const ledger = handle.deployTxData.public;
  return {
    owner: ledger.owner,
    guardianCount: ledger.guardianCount,
    recoveryInitiatedAt: ledger.recoveryInitiatedAt,
    sharesCidHash: ledger.sharesCidHash,
    recoveryComplete: ledger.recoveryComplete,
    approvalCount: Number(ledger.approvedGuardians.size()),
  };
}

/**
 * Check if a guardian commitment is registered in the contract.
 */
export function isGuardian(handle: ContractHandle, guardianCommitment: Uint8Array): boolean {
  const ledger = handle.deployTxData.public;
  return ledger.guardians.member(guardianCommitment);
}

/**
 * Check if a guardian has already approved the recovery.
 */
export function hasApproved(handle: ContractHandle, guardianCommitment: Uint8Array): boolean {
  const ledger = handle.deployTxData.public;
  return ledger.approvedGuardians.member(guardianCommitment);
}

/**
 * Call approveRecovery circuit on the contract.
 * Proof generation can be CPU-intensive (several seconds).
 */
export async function approveRecovery(handle: ContractHandle): Promise<void> {
  await handle.callTx.approveRecovery();
}
