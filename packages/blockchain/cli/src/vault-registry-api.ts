import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { VaultRegistry, vaultRegistryWitnesses, createVaultRegistryPrivateState } from '@aliasvault/contract';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type Logger } from 'pino';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
import {
  type VaultRegistryPrivateState,
  type VaultRegistryProviders,
  type DeployedVaultRegistryContract,
} from './vault-registry-types';
import path from 'node:path';
import { currentDir } from './config';

let logger: Logger;

const vaultRegistryZkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'vault-registry');

const vaultRegistryCompiledContract = CompiledContract.make('vault-registry', VaultRegistry.Contract).pipe(
  CompiledContract.withWitnesses(vaultRegistryWitnesses),
  CompiledContract.withCompiledFileAssets(vaultRegistryZkConfigPath),
);

export const initVaultRegistryLogger = (l: Logger): void => {
  logger = l;
};

/**
 * Asserts that a CID string is CIDv1 format (base32-encoded).
 * Per project-context.md Rule 2: ALL IPFS CIDs MUST be CIDv1 format.
 */
export const assertCIDv1 = (cid: string): void => {
  if (cid.startsWith('Qm')) {
    throw new Error('CIDv0 detected. Convert to CIDv1 using IPFS CID.parse().');
  }
  if (!/^[a-z2-7]/.test(cid)) {
    throw new Error('CID must be base32 encoded (CIDv1).');
  }
};

export const deployVaultRegistry = async (
  providers: VaultRegistryProviders,
  secretKey: Uint8Array,
): Promise<DeployedVaultRegistryContract> => {
  logger.info('Deploying VaultRegistry contract...');
  const contract = await deployContract(providers, {
    compiledContract: vaultRegistryCompiledContract,
    privateStateId: 'vaultRegistryPrivateState',
    initialPrivateState: createVaultRegistryPrivateState(secretKey),
  });
  logger.info(`VaultRegistry deployed at address: ${contract.deployTxData.public.contractAddress}`);
  return contract;
};

export const joinVaultRegistry = async (
  providers: VaultRegistryProviders,
  contractAddress: string,
  secretKey: Uint8Array,
): Promise<DeployedVaultRegistryContract> => {
  const contract = await findDeployedContract(providers, {
    contractAddress,
    compiledContract: vaultRegistryCompiledContract,
    privateStateId: 'vaultRegistryPrivateState',
    initialPrivateState: createVaultRegistryPrivateState(secretKey),
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

export const updateVault = async (
  contract: DeployedVaultRegistryContract,
  newCidHash: Uint8Array,
): Promise<void> => {
  logger.info('Updating vault CID...');
  const result = await contract.callTx.updateVault(newCidHash);
  logger.info(`updateVault tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const checkIsRegistered = async (
  contract: DeployedVaultRegistryContract,
  walletAddressHash: Uint8Array,
): Promise<boolean> => {
  logger.info('Checking registration status...');
  const result = await contract.callTx.isRegistered(walletAddressHash);
  logger.info(`isRegistered tx ${result.public.txId} in block ${result.public.blockHeight}`);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const isRegistered = (result as unknown as { public: { returnValue: boolean } }).public?.returnValue ?? true;
  return Boolean(isRegistered);
};

export const getVaultRegistryLedgerState = async (
  providers: VaultRegistryProviders,
  contractAddress: ContractAddress,
): Promise<{ totalVaults: bigint; owner: Uint8Array; vaultCidHash: Uint8Array } | null> => {
  assertIsContractAddress(contractAddress);
  logger.info('Checking VaultRegistry ledger state...');
  const state = await providers.publicDataProvider
    .queryContractState(contractAddress)
    .then((contractState) => {
      if (contractState == null) return null;
      const ledgerState = VaultRegistry.ledger(contractState.data);
      return {
        totalVaults: ledgerState.totalVaults,
        owner: ledgerState.owner,
        vaultCidHash: ledgerState.vaultCidHash,
      };
    });
  logger.info(`VaultRegistry state: totalVaults=${state?.totalVaults ?? 'N/A'}`);
  return state;
};
