/**
 * Recovery claim service for the browser extension.
 * Handles the vault owner's recovery flow:
 * 1. Read on-chain recovery key hash from VaultRegistry
 * 2. Fetch share package from IPFS
 * 3. Execute off-chain claim (combine shares, verify hash, decrypt password)
 * 4. Call on-chain claimRecovery() on GuardianRecovery (terminal state)
 * 5. Read GuardianRecovery ledger state for status display
 *
 * Architecture: ADR-003 — crypto logic delegated to @aliasvault/vault-sync.
 * This service handles only I/O (contract reads, IPFS fetch, contract calls).
 */

import { getNetworkConfig } from '../entrypoints/popup/config/networkConfig';

export interface RecoveryState {
  recoveryInitiatedAt: bigint;
  approvalCount: number;
  recoveryComplete: boolean;
  sharesCidHash: Uint8Array;
}

/**
 * Validate a raw JSON object as a RecoveryShareFile.
 * Delegates to validateShareFile() from @aliasvault/vault-sync (ADR-003).
 */
export async function validateImportedShare(
  data: unknown,
): Promise<import('@aliasvault/vault-sync').RecoveryShareFile> {
  const { validateShareFile } = await import('@aliasvault/vault-sync');
  return validateShareFile(data);
}

/**
 * Read the recoveryKeyHash from VaultRegistry contract ledger via indexer.
 * Uses Pattern B (publicDataProvider.queryContractState + ledger decoder).
 *
 * @returns 32-byte recovery key hash, or null if contract not found
 */
export async function fetchOnChainRecoveryKeyHash(
  contractAddress: string,
  indexerUrl: string = getNetworkConfig().indexerUrl,
): Promise<Uint8Array | null> {
  const { indexerPublicDataProvider } = await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  );
  const { VaultRegistry } = await import('@aliasvault/contract');

  const publicDataProvider = indexerPublicDataProvider(indexerUrl);
  const contractState = await publicDataProvider.queryContractState(contractAddress);

  if (!contractState) {
    return null;
  }

  const ledgerState = VaultRegistry.ledger(contractState.data);
  return ledgerState.recoveryKeyHash as Uint8Array;
}

/**
 * Fetch and validate a GuardianSharePackage from IPFS.
 * Downloads raw bytes via Pinata gateway, then parses and validates.
 *
 * @param sharesCid - CIDv1 of the share package on IPFS
 * @param pinataGateway - Pinata gateway domain (e.g., "your-gateway.mypinata.cloud")
 */
export async function fetchSharePackageFromIpfs(
  sharesCid: string,
  pinataGateway: string,
) {
  const { assertCIDv1 } = await import('@aliasvault/contract');
  const { parseSharePackageFromBytes } = await import('@aliasvault/vault-sync');

  assertCIDv1(sharesCid);

  const url = `https://${pinataGateway}/files/${sharesCid}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch share package from IPFS: HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return parseSharePackageFromBytes(new Uint8Array(buffer));
}

/**
 * Execute the off-chain recovery claim: combine shares, verify hash, decrypt password.
 * Delegates to claimRecovery() from @aliasvault/vault-sync (ADR-003).
 *
 * @param shareFiles - 2+ RecoveryShareFile JSON objects from guardians
 * @param sharePackage - GuardianSharePackage fetched from IPFS
 * @param onChainHash - recoveryKeyHash from VaultRegistry ledger
 */
export async function executeRecoveryClaim(
  shareFiles: import('@aliasvault/vault-sync').RecoveryShareFile[],
  sharePackage: import('@aliasvault/vault-sync').GuardianSharePackage,
  onChainHash: Uint8Array,
) {
  const { claimRecovery, RecoveryClaimError } = await import('@aliasvault/vault-sync');

  try {
    return await claimRecovery({
      sharePackage,
      shareFiles,
      onChainRecoveryKeyHash: onChainHash,
    });
  } catch (error) {
    if (error instanceof RecoveryClaimError) {
      throw error; // Re-throw with structured error code
    }
    throw new Error(
      `Recovery claim failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Call claimRecovery() on the GuardianRecovery contract (terminal state).
 * Joins the contract as owner (requires secretKey for owner auth),
 * then calls the claimRecovery circuit.
 *
 * IMPORTANT: Only call after off-chain password recovery succeeds.
 * This sets recoveryComplete = true (permanent, no reset).
 *
 * @param contractAddress - GuardianRecovery contract address
 * @param secretKey - Owner's 32-byte secret key (from SQLite vault DB)
 */
export async function callClaimRecoveryOnChain(
  contractAddress: string,
  secretKey: Uint8Array,
  indexerUrl?: string,
  proofServerUrl?: string,
): Promise<void> {
  const defaults = getNetworkConfig();
  indexerUrl ??= defaults.indexerUrl;
  proofServerUrl ??= defaults.proofServerUrl;
  const { findDeployedContract } = await import('@midnight-ntwrk/midnight-js-contracts');
  const { indexerPublicDataProvider } = await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  );
  const { httpClientProofProvider } = await import(
    '@midnight-ntwrk/midnight-js-http-client-proof-provider'
  );
  const {
    GuardianRecovery,
    guardianRecoveryWitnesses,
    createGuardianRecoveryPrivateState,
  } = await import('@aliasvault/contract');
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');

  const compiledContract = CompiledContract.make(
    'guardian-recovery',
    GuardianRecovery.Contract,
  ).pipe(CompiledContract.withWitnesses(guardianRecoveryWitnesses));

  const providers = {
    proofProvider: httpClientProofProvider(proofServerUrl),
    publicDataProvider: indexerPublicDataProvider(indexerUrl),
  };

  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: compiledContract as any,
    privateStateId: 'guardianRecoveryPrivateState',
    initialPrivateState: createGuardianRecoveryPrivateState(secretKey),
  });

  await (contract as any).callTx.claimRecovery();
}

/**
 * Read the GuardianRecovery contract ledger state via indexer.
 * Uses Pattern B (publicDataProvider.queryContractState + ledger decoder).
 *
 * @returns Recovery state fields, or null if contract not found
 */
export async function getRecoveryState(
  contractAddress: string,
  indexerUrl: string = getNetworkConfig().indexerUrl,
): Promise<RecoveryState | null> {
  const { indexerPublicDataProvider } = await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  );
  const { GuardianRecovery } = await import('@aliasvault/contract');

  const publicDataProvider = indexerPublicDataProvider(indexerUrl);
  const contractState = await publicDataProvider.queryContractState(contractAddress);

  if (!contractState) {
    return null;
  }

  const ledger = GuardianRecovery.ledger(contractState.data);

  return {
    recoveryInitiatedAt: ledger.recoveryInitiatedAt as bigint,
    approvalCount: Number((ledger.approvedGuardians as any).size()),
    recoveryComplete: ledger.recoveryComplete as boolean,
    sharesCidHash: ledger.sharesCidHash as Uint8Array,
  };
}
