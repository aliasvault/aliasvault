import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { VaultRegistry } from '@aliasvault/contract';
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
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(vaultRegistryZkConfigPath),
);

export const vaultRegistryContractInstance = new VaultRegistry.Contract({});

export const initVaultRegistryLogger = (l: Logger): void => {
  logger = l;
};

export const deployVaultRegistry = async (
  providers: VaultRegistryProviders,
): Promise<DeployedVaultRegistryContract> => {
  logger.info('Deploying VaultRegistry contract...');
  const contract = await deployContract(providers, {
    compiledContract: vaultRegistryCompiledContract,
    privateStateId: 'vaultRegistryPrivateState',
    initialPrivateState: {} as VaultRegistryPrivateState,
  });
  logger.info(`VaultRegistry deployed at address: ${contract.deployTxData.public.contractAddress}`);
  return contract;
};

export const joinVaultRegistry = async (
  providers: VaultRegistryProviders,
  contractAddress: string,
): Promise<DeployedVaultRegistryContract> => {
  const contract = await findDeployedContract(providers, {
    contractAddress,
    compiledContract: vaultRegistryCompiledContract,
    privateStateId: 'vaultRegistryPrivateState',
    initialPrivateState: {} as VaultRegistryPrivateState,
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

export const checkIsRegistered = async (
  contract: DeployedVaultRegistryContract,
  walletAddressHash: Uint8Array,
): Promise<boolean> => {
  logger.info('Checking registration status...');
  const result = await contract.callTx.isRegistered(walletAddressHash);
  logger.info(`isRegistered tx ${result.public.txId} in block ${result.public.blockHeight}`);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  const isRegistered = (result as any).public?.returnValue ?? true;
  return Boolean(isRegistered);
};

export const getVaultRegistryLedgerState = async (
  providers: VaultRegistryProviders,
  contractAddress: ContractAddress,
): Promise<{ totalVaults: bigint } | null> => {
  assertIsContractAddress(contractAddress);
  logger.info('Checking VaultRegistry ledger state...');
  const state = await providers.publicDataProvider
    .queryContractState(contractAddress)
    .then((contractState) => {
      if (contractState == null) return null;
      const ledgerState = VaultRegistry.ledger(contractState.data);
      return { totalVaults: ledgerState.totalVaults };
    });
  logger.info(`VaultRegistry state: totalVaults=${state?.totalVaults ?? 'N/A'}`);
  return state;
};
