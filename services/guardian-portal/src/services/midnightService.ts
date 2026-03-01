import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { toHex, fromHex } from '@midnight-ntwrk/compact-runtime';
import {
  Transaction,
  type FinalizedTransaction,
  type TransactionId,
} from '@midnight-ntwrk/ledger-v7';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';
import {
  GuardianRecovery,
  createGuardianRecoveryPrivateState,
  guardianRecoveryWitnesses,
} from '@aliasvault/contract';
import type { ConnectedAPI, ShieldedAddresses, ServiceConfiguration } from './walletService';
import { inMemoryPrivateStateProvider } from './inMemoryPrivateStateProvider';

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
 * the browser relies on FetchZkConfigProvider for ZK keys — no file assets needed.
 */
const guardianRecoveryCompiledContract = CompiledContract.make('guardian-recovery', GuardianRecovery.Contract).pipe(
  CompiledContract.withWitnesses(guardianRecoveryWitnesses),
);

export type ContractHandle = Awaited<ReturnType<typeof joinContract>>;

/**
 * Build the full MidnightProviders required by findDeployedContract.
 *
 * All 6 providers are wired following the bboard pattern:
 * - publicDataProvider: indexerPublicDataProvider (from Lace serviceConfig)
 * - proofProvider: httpClientProofProvider (from Lace proverServerUri)
 * - zkConfigProvider: FetchZkConfigProvider (static keys from window.location.origin)
 * - privateStateProvider: inMemoryPrivateStateProvider (ephemeral, Map-backed)
 * - walletProvider: constructed from ConnectedAPI (balanceUnsealedTransaction)
 * - midnightProvider: constructed from ConnectedAPI (submitTransaction)
 *
 * Cross-referenced against: bboard, midnight-bank, MeshJS template, midnight-game-2
 *
 * Before wallet connection, walletProvider and midnightProvider reject with 'readonly'
 * to allow state reading without a connected wallet (Pattern from midnight-bank).
 */
export function configureGuardianProviders(
  connectedAPI: ConnectedAPI | null,
  shieldedAddresses: ShieldedAddresses | null,
  serviceConfig: ServiceConfiguration | null,
) {
  // zkConfigProvider: FetchZkConfigProvider fetches keys/zkir from static assets
  // Pattern: bboard, MeshJS, midnight-bank, midnight-game-2 (all 4 use this)
  const zkConfigProvider = new FetchZkConfigProvider(window.location.origin, fetch.bind(window));

  // privateStateProvider: in-memory, ephemeral — sufficient for guardian approval
  // Pattern: bboard, MeshJS, naval-battle-game use in-memory
  const privateStateProvider = inMemoryPrivateStateProvider();

  // proofProvider: uses proverServerUri from Lace getConfiguration()
  // Falls back to empty string when wallet not yet connected (will fail at call time, which is expected)
  const proofProvider = httpClientProofProvider(
    serviceConfig?.proverServerUri ?? '',
    zkConfigProvider,
  );

  // publicDataProvider: uses indexerUri/indexerWsUri from Lace getConfiguration()
  // Falls back to empty strings when wallet not yet connected
  const publicDataProvider = indexerPublicDataProvider(
    serviceConfig?.indexerUri ?? '',
    serviceConfig?.indexerWsUri ?? '',
  );

  // walletProvider: constructed from ConnectedAPI when connected
  // Before wallet connection, rejects with 'readonly' error
  // Pattern: midnight-bank BankWallet.tsx — readonly stub until wallet connects
  const walletProvider = {
    getCoinPublicKey(): string {
      if (!shieldedAddresses) throw new Error('readonly');
      return shieldedAddresses.shieldedCoinPublicKey;
    },
    getEncryptionPublicKey(): string {
      if (!shieldedAddresses) throw new Error('readonly');
      return shieldedAddresses.shieldedEncryptionPublicKey;
    },
    async balanceTx(tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> {
      if (!connectedAPI) throw new Error('readonly');
      // Exact pattern from bboard BrowserDeployedBoardManager.ts lines 241-254
      // Cross-confirmed: MeshJS counter-providers.tsx lines 260-290
      const serializedTx = toHex(tx.serialize());
      const received = await connectedAPI.balanceUnsealedTransaction(serializedTx);
      return Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        fromHex(received.tx),
      ) as FinalizedTransaction;
    },
  };

  // midnightProvider: constructed from ConnectedAPI when connected
  // Pattern: identical across bboard, MeshJS, midnight-game-2, midnight-bank
  const midnightProvider = {
    async submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
      if (!connectedAPI) throw new Error('readonly');
      await connectedAPI.submitTransaction(toHex(tx.serialize()));
      const txIdentifiers = tx.identifiers();
      return txIdentifiers[0] as TransactionId;
    },
  };

  return {
    publicDataProvider,
    proofProvider,
    zkConfigProvider,
    privateStateProvider,
    walletProvider,
    midnightProvider,
  };
}

/**
 * Join an existing GuardianRecovery contract instance as a guardian.
 * Guardian passes undefined for secretKey (not the owner), guardianKey for witness.
 */
export async function joinContract(
  contractAddress: string,
  guardianKey: Uint8Array,
  connectedAPI: ConnectedAPI | null,
  shieldedAddresses: ShieldedAddresses | null,
  serviceConfig: ServiceConfiguration | null,
) {
  const providers = configureGuardianProviders(connectedAPI, shieldedAddresses, serviceConfig);

  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: guardianRecoveryCompiledContract as any,
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
  const ledger = handle.deployTxData.public as unknown as GuardianRecovery.Ledger;
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
  const ledger = handle.deployTxData.public as unknown as GuardianRecovery.Ledger;
  return ledger.guardians.member(guardianCommitment);
}

/**
 * Check if a guardian has already approved the recovery.
 */
export function hasApproved(handle: ContractHandle, guardianCommitment: Uint8Array): boolean {
  const ledger = handle.deployTxData.public as unknown as GuardianRecovery.Ledger;
  return ledger.approvedGuardians.member(guardianCommitment);
}

/**
 * Call approveRecovery circuit on the contract.
 * Proof generation can be CPU-intensive (several seconds).
 */
export async function approveRecovery(handle: ContractHandle): Promise<void> {
  await handle.callTx.approveRecovery!();
}
