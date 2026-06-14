import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
    VaultRegistry,
    vaultRegistryWitnesses,
    createVaultRegistryPrivateState,
    assertCIDv1,
} from '@aliasvault/contract';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type Logger } from 'pino';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
import { type VaultRegistryProviders, type DeployedVaultRegistryContract } from './vault-registry-types';
import crypto from 'node:crypto';
import path from 'node:path';
import { currentDir } from './config';

let logger: Logger;

export const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

export const vaultRegistryZkConfigPath = path.resolve(
    currentDir,
    '..',
    '..',
    'contract',
    'src',
    'managed',
    'vault-registry',
);

const vaultRegistryCompiledContract = CompiledContract.make('vault-registry', VaultRegistry.Contract).pipe(
    CompiledContract.withWitnesses(vaultRegistryWitnesses),
    CompiledContract.withCompiledFileAssets(vaultRegistryZkConfigPath),
);

export const initVaultRegistryLogger = (l: Logger): void => {
    logger = l;
};

// Re-export assertCIDv1 from contract package for backward compatibility
export { assertCIDv1 } from '@aliasvault/contract';

// Application-layer CID store — maps contract address to the full CID string.
// The actual CID is too large for Bytes<32>, so only its hash goes on-chain.
// ⚠️ IN-MEMORY ONLY: This Map is lost on process restart. Acceptable because:
//   - The CLI/TUI is a test harness, not the production client.
//   - The browser extension (production) will persist CIDs in IndexedDB (Stories 2.3/2.4).
//   - CIDs are recoverable via Pinata pin list + on-chain hash matching.
const vaultCidStore = new Map<string, string>();

export const deployVaultRegistry = async (
    providers: VaultRegistryProviders,
    secretKey: Uint8Array,
    backupKey?: Uint8Array,
): Promise<DeployedVaultRegistryContract> => {
    logger.info('Deploying VaultRegistry contract...');
    const contract = await deployContract(providers, {
        compiledContract: vaultRegistryCompiledContract,
        privateStateId: 'vaultRegistryPrivateState',
        initialPrivateState: createVaultRegistryPrivateState(secretKey, backupKey),
    });
    logger.info(`VaultRegistry deployed at address: ${contract.deployTxData.public.contractAddress}`);
    return contract;
};

export const joinVaultRegistry = async (
    providers: VaultRegistryProviders,
    contractAddress: string,
    secretKey: Uint8Array,
    backupKey?: Uint8Array,
): Promise<DeployedVaultRegistryContract> => {
    const contract = await findDeployedContract(providers, {
        contractAddress,
        compiledContract: vaultRegistryCompiledContract,
        privateStateId: 'vaultRegistryPrivateState',
        initialPrivateState: createVaultRegistryPrivateState(secretKey, backupKey),
    });
    logger.info(`Joined VaultRegistry at address: ${contract.deployTxData.public.contractAddress}`);
    return contract;
};

export const registerVault = async (
    contract: DeployedVaultRegistryContract,
    walletAddressHash: Uint8Array,
): Promise<void> => {
    logger.info('Registering vault...');
    const result = await contract.callTx.registerVault(walletAddressHash);
    logger.info(`Registration tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const updateVault = async (contract: DeployedVaultRegistryContract, newCid: string): Promise<void> => {
    assertCIDv1(newCid);
    const cidHash = crypto.createHash('sha256').update(newCid).digest();
    logger.info(`Updating vault CID (hash: ${Buffer.from(cidHash).toString('hex').slice(0, 16)}...)`);
    const result = await contract.callTx.updateVault(cidHash);
    // Store the full CID locally after successful on-chain update
    const contractAddress = contract.deployTxData.public.contractAddress;
    vaultCidStore.set(contractAddress, newCid);
    logger.info(`updateVault tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

/**
 * Retrieve the vault CID from the application-layer private store.
 * The full CID is stored locally (too large for Bytes<32>);
 * the on-chain vaultCidHash serves as integrity proof.
 * Returns null if no CID has been stored for this contract.
 */
export const getVaultCID = (contract: DeployedVaultRegistryContract): string | null => {
    const contractAddress = contract.deployTxData.public.contractAddress;
    return vaultCidStore.get(contractAddress) ?? null;
};

export const checkIsRegistered = async (
    contract: DeployedVaultRegistryContract,
    walletAddressHash: Uint8Array,
): Promise<boolean> => {
    logger.info('Checking registration status...');
    const result = await contract.callTx.isRegistered(walletAddressHash);
    logger.info(`isRegistered tx ${result.public.txId} in block ${result.public.blockHeight}`);

    const returnValue = (result as unknown as { public: { returnValue: boolean } }).public?.returnValue;
    if (returnValue === undefined) {
        throw new Error('Failed to extract returnValue from isRegistered transaction result');
    }
    return Boolean(returnValue);
};

export const transferOwnership = async (
    contract: DeployedVaultRegistryContract,
    newOwnerCommitment: Uint8Array,
): Promise<void> => {
    logger.info('Transferring ownership...');
    const result = await contract.callTx.transferOwnership(newOwnerCommitment);
    logger.info(`transferOwnership tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const storeRecoveryKeyHash = async (
    contract: DeployedVaultRegistryContract,
    keyHash: Uint8Array,
): Promise<void> => {
    logger.info('Storing recovery key hash...');
    const result = await contract.callTx.storeRecoveryKeyHash(keyHash);
    logger.info(`storeRecoveryKeyHash tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const addBackupWallet = async (
    contract: DeployedVaultRegistryContract,
    walletCommitment: Uint8Array,
    currentTime: bigint,
): Promise<void> => {
    logger.info(`Adding backup wallet (registeredAt=${currentTime})...`);
    const result = await contract.callTx.addBackupWallet(walletCommitment, currentTime);
    logger.info(`addBackupWallet tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const removeBackupWallet = async (
    contract: DeployedVaultRegistryContract,
    walletCommitment: Uint8Array,
): Promise<void> => {
    logger.info('Removing backup wallet...');
    const result = await contract.callTx.removeBackupWallet(walletCommitment);
    logger.info(`removeBackupWallet tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const backupTransfer = async (
    contract: DeployedVaultRegistryContract,
    newOwnerCommitment: Uint8Array,
): Promise<void> => {
    logger.info('Executing backup transfer...');
    const result = await contract.callTx.backupTransfer(newOwnerCommitment);
    logger.info(`backupTransfer tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const checkIsBackupWallet = async (
    providers: VaultRegistryProviders,
    contractAddress: ContractAddress,
    walletCommitment: Uint8Array,
): Promise<boolean> => {
    assertIsContractAddress(contractAddress);
    logger.info('Checking backup wallet membership...');
    const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
    if (contractState == null) return false;
    const ledgerState = VaultRegistry.ledger(contractState.data);
    return ledgerState.backupWallets.member(walletCommitment);
};

export const getVaultRegistryLedgerState = async (
    providers: VaultRegistryProviders,
    contractAddress: ContractAddress,
): Promise<{
    totalVaults: bigint;
    owner: Uint8Array;
    vaultCidHash: Uint8Array;
    recoveryKeyHash: Uint8Array;
    backupWalletsEmpty: boolean;
    backupWalletsSize: bigint;
} | null> => {
    assertIsContractAddress(contractAddress);
    logger.info('Checking VaultRegistry ledger state...');
    const state = await providers.publicDataProvider.queryContractState(contractAddress).then((contractState) => {
        if (contractState == null) return null;
        const ledgerState = VaultRegistry.ledger(contractState.data);
        return {
            totalVaults: ledgerState.totalVaults,
            owner: ledgerState.owner,
            vaultCidHash: ledgerState.vaultCidHash,
            recoveryKeyHash: ledgerState.recoveryKeyHash,
            backupWalletsEmpty: ledgerState.backupWallets.isEmpty(),
            backupWalletsSize: ledgerState.backupWallets.size(),
        };
    });
    logger.info(`VaultRegistry state: totalVaults=${state?.totalVaults ?? 'N/A'}`);
    return state;
};
