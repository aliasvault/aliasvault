/**
 * Backup wallet service for the browser extension.
 * Handles backup wallet management and transfer execution:
 * 1. Add backup wallet with commitment + registration timestamp
 * 2. Remove backup wallet
 * 3. Read backup wallet status (maturation state) from ledger
 * 4. Execute maturity-based backup transfer
 *
 * Architecture: ADR-003 — maturation logic is enforced ON-CHAIN.
 * This service handles only I/O (contract reads, contract calls).
 * The 72h maturation check is purely on-chain via blockTimeGte().
 */

import { getNetworkConfig } from '../entrypoints/popup/config/networkConfig';

export interface BackupWalletInfo {
  commitment: Uint8Array;
  registeredAt: bigint;
  matured: boolean;
  timeRemaining: number; // seconds until maturation, 0 if matured
}

const MATURATION_PERIOD_SECONDS = 259200; // 72 hours

/**
 * Read backup wallet status from VaultRegistry ledger via indexer.
 * Uses Pattern B (publicDataProvider.queryContractState + ledger decoder).
 *
 * Returns an array of backup wallet info with maturation status calculated
 * by comparing registration timestamp + 72h against current wall-clock time.
 *
 * NOTE: The definitive maturation check is on-chain (blockTimeGte). This
 * client-side calculation is for UI display only.
 */
export async function getBackupWalletStatus(
  contractAddress: string,
  indexerUrl: string = getNetworkConfig().indexerUrl,
): Promise<BackupWalletInfo[]> {
  const { indexerPublicDataProvider } = await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  );
  const { VaultRegistry } = await import('@aliasvault/contract');

  const publicDataProvider = indexerPublicDataProvider(indexerUrl);
  const contractState = await publicDataProvider.queryContractState(contractAddress);

  if (!contractState) {
    return [];
  }

  const ledgerState = VaultRegistry.ledger(contractState.data);
  const backupWallets = ledgerState.backupWallets;
  const wallets: BackupWalletInfo[] = [];
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Iterate backup wallets Map via TypeScript [Symbol.iterator]
  for (const [commitment, registeredAt] of backupWallets) {
    const unlockTime = Number(registeredAt) + MATURATION_PERIOD_SECONDS;
    const matured = nowSeconds >= unlockTime;
    const timeRemaining = matured ? 0 : unlockTime - nowSeconds;
    wallets.push({
      commitment: commitment as Uint8Array,
      registeredAt: registeredAt as bigint,
      matured,
      timeRemaining,
    });
  }

  return wallets;
}

/**
 * Compute backup commitment from a backup key using the contract's pure circuit.
 * Wraps the dynamic import so callers don't need @aliasvault/contract directly.
 */
export async function computeBackupCommitment(
  backupKey: Uint8Array,
): Promise<Uint8Array> {
  const { VaultRegistry } = await import('@aliasvault/contract');
  return VaultRegistry.pureCircuits.backupCommitment(backupKey);
}

/**
 * Add a backup wallet to the VaultRegistry contract.
 * Computes commitment from backupKey using the contract's pure circuit,
 * then calls addBackupWallet with commitment + current timestamp.
 *
 * @param contractAddress - VaultRegistry contract address
 * @param backupKey - 32-byte backup key (raw secret)
 * @param secretKey - Owner's 32-byte secret key for authentication
 */
export async function addBackupWallet(
  contractAddress: string,
  backupKey: Uint8Array,
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
    VaultRegistry,
    vaultRegistryWitnesses,
    createVaultRegistryPrivateState,
  } = await import('@aliasvault/contract');
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');

  const compiledContract = CompiledContract.make(
    'vault-registry',
    VaultRegistry.Contract,
  ).pipe(CompiledContract.withWitnesses(vaultRegistryWitnesses));

  const providers = {
    proofProvider: httpClientProofProvider(proofServerUrl),
    publicDataProvider: indexerPublicDataProvider(indexerUrl),
  };

  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: compiledContract as any,
    privateStateId: 'vaultRegistryPrivateState',
    initialPrivateState: createVaultRegistryPrivateState(secretKey),
  });

  // Compute backup commitment using pure circuit
  const commitment = VaultRegistry.pureCircuits.backupCommitment(backupKey);
  const currentTime = BigInt(Math.floor(Date.now() / 1000));

  await (contract as any).callTx.addBackupWallet(commitment, currentTime);
}

/**
 * Remove a backup wallet from the VaultRegistry contract.
 *
 * @param contractAddress - VaultRegistry contract address
 * @param walletCommitment - Commitment of the backup wallet to remove
 * @param secretKey - Owner's 32-byte secret key for authentication
 */
export async function removeBackupWallet(
  contractAddress: string,
  walletCommitment: Uint8Array,
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
    VaultRegistry,
    vaultRegistryWitnesses,
    createVaultRegistryPrivateState,
  } = await import('@aliasvault/contract');
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');

  const compiledContract = CompiledContract.make(
    'vault-registry',
    VaultRegistry.Contract,
  ).pipe(CompiledContract.withWitnesses(vaultRegistryWitnesses));

  const providers = {
    proofProvider: httpClientProofProvider(proofServerUrl),
    publicDataProvider: indexerPublicDataProvider(indexerUrl),
  };

  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: compiledContract as any,
    privateStateId: 'vaultRegistryPrivateState',
    initialPrivateState: createVaultRegistryPrivateState(secretKey),
  });

  await (contract as any).callTx.removeBackupWallet(walletCommitment);
}

/**
 * Execute a backup transfer on the VaultRegistry contract.
 * Only callable by a registered and mature backup wallet holder.
 *
 * @param contractAddress - VaultRegistry contract address
 * @param backupKey - Caller's 32-byte backup key (must be registered + mature)
 * @param newOwnerCommitment - Commitment of the new owner
 */
export async function executeBackupTransfer(
  contractAddress: string,
  backupKey: Uint8Array,
  newOwnerCommitment: Uint8Array,
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
    VaultRegistry,
    vaultRegistryWitnesses,
    createVaultRegistryPrivateState,
  } = await import('@aliasvault/contract');
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');

  // Join contract with backupKey in private state (as backup wallet holder)
  const compiledContract = CompiledContract.make(
    'vault-registry',
    VaultRegistry.Contract,
  ).pipe(CompiledContract.withWitnesses(vaultRegistryWitnesses));

  const providers = {
    proofProvider: httpClientProofProvider(proofServerUrl),
    publicDataProvider: indexerPublicDataProvider(indexerUrl),
  };

  // Use a dummy secret key — the backup wallet holder authenticates via backupKey
  const dummySecretKey = new Uint8Array(32);
  const contract = await findDeployedContract(providers as any, {
    contractAddress,
    compiledContract: compiledContract as any,
    privateStateId: 'vaultRegistryPrivateState',
    initialPrivateState: createVaultRegistryPrivateState(dummySecretKey, backupKey),
  });

  await (contract as any).callTx.backupTransfer(newOwnerCommitment);
}
