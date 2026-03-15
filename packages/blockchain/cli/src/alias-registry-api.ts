import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { AliasRegistry, aliasRegistryWitnesses, createAliasRegistryPrivateState } from '@aliasvault/contract';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type Logger } from 'pino';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
import {
  type AliasRegistryProviders,
  type DeployedAliasRegistryContract,
  AliasRegistryPrivateStateId,
} from './alias-registry-types';
import path from 'node:path';
import { currentDir } from './config';

let logger: Logger;

export const aliasRegistryZkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'alias-registry');

const aliasRegistryCompiledContract = CompiledContract.make('alias-registry', AliasRegistry.Contract).pipe(
  CompiledContract.withWitnesses(aliasRegistryWitnesses),
  CompiledContract.withCompiledFileAssets(aliasRegistryZkConfigPath),
);

export const initAliasRegistryLogger = (l: Logger): void => {
  logger = l;
};

export const deployAliasRegistry = async (
  providers: AliasRegistryProviders,
  secretKey: Uint8Array,
): Promise<DeployedAliasRegistryContract> => {
  logger.info('Deploying AliasRegistry contract...');
  const contract = await deployContract(providers, {
    compiledContract: aliasRegistryCompiledContract,
    privateStateId: AliasRegistryPrivateStateId,
    initialPrivateState: createAliasRegistryPrivateState(secretKey),
  });
  logger.info(`AliasRegistry deployed at address: ${contract.deployTxData.public.contractAddress}`);
  return contract;
};

export const getAliasRegistryLedgerState = async (
  providers: AliasRegistryProviders,
  contractAddress: ContractAddress,
): Promise<{
  totalClaimCount: bigint;
  aliasOwnersEmpty: boolean;
  aliasOwnersSize: bigint;
} | null> => {
  assertIsContractAddress(contractAddress);
  logger.info('Checking AliasRegistry ledger state...');
  const state = await providers.publicDataProvider
    .queryContractState(contractAddress)
    .then((contractState) => {
      if (contractState == null) return null;
      const ledgerState = AliasRegistry.ledger(contractState.data);
      return {
        totalClaimCount: ledgerState.totalClaimCount,
        aliasOwnersEmpty: ledgerState.aliasOwners.isEmpty(),
        aliasOwnersSize: ledgerState.aliasOwners.size(),
      };
    });
  logger.info(`AliasRegistry state: totalClaimCount=${state?.totalClaimCount ?? 'N/A'}`);
  return state;
};
