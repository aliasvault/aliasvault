import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { GuardianRecovery, guardianRecoveryWitnesses, createGuardianRecoveryPrivateState } from '@aliasvault/contract';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { type Logger } from 'pino';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
import { type GuardianRecoveryProviders, type DeployedGuardianRecoveryContract } from './guardian-recovery-types';
import path from 'node:path';
import { currentDir } from './config';

let logger: Logger;

export const guardianRecoveryZkConfigPath = path.resolve(
    currentDir,
    '..',
    '..',
    'contract',
    'src',
    'managed',
    'guardian-recovery',
);

const guardianRecoveryCompiledContract = CompiledContract.make('guardian-recovery', GuardianRecovery.Contract).pipe(
    CompiledContract.withWitnesses(guardianRecoveryWitnesses),
    CompiledContract.withCompiledFileAssets(guardianRecoveryZkConfigPath),
);

export const initGuardianRecoveryLogger = (l: Logger): void => {
    logger = l;
};

export const deployGuardianRecovery = async (
    providers: GuardianRecoveryProviders,
    secretKey: Uint8Array,
    guardianKey?: Uint8Array,
): Promise<DeployedGuardianRecoveryContract> => {
    logger.info('Deploying GuardianRecovery contract...');
    const contract = await deployContract(providers, {
        compiledContract: guardianRecoveryCompiledContract,
        privateStateId: 'guardianRecoveryPrivateState',
        initialPrivateState: createGuardianRecoveryPrivateState(secretKey, guardianKey),
    });
    logger.info(`GuardianRecovery deployed at address: ${contract.deployTxData.public.contractAddress}`);
    return contract;
};

export const joinGuardianRecovery = async (
    providers: GuardianRecoveryProviders,
    contractAddress: string,
    secretKey: Uint8Array,
    guardianKey?: Uint8Array,
): Promise<DeployedGuardianRecoveryContract> => {
    const contract = await findDeployedContract(providers, {
        contractAddress,
        compiledContract: guardianRecoveryCompiledContract,
        privateStateId: 'guardianRecoveryPrivateState',
        initialPrivateState: createGuardianRecoveryPrivateState(secretKey, guardianKey),
    });
    logger.info(`Joined GuardianRecovery at address: ${contract.deployTxData.public.contractAddress}`);
    return contract;
};

export const initialize = async (contract: DeployedGuardianRecoveryContract, ownerCom: Uint8Array): Promise<void> => {
    logger.info('Initializing GuardianRecovery...');
    const result = await contract.callTx.initialize(ownerCom);
    logger.info(`initialize tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const addGuardian = async (
    contract: DeployedGuardianRecoveryContract,
    guardianCom: Uint8Array,
): Promise<void> => {
    logger.info('Adding guardian...');
    const result = await contract.callTx.addGuardian(guardianCom);
    logger.info(`addGuardian tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const removeGuardian = async (
    contract: DeployedGuardianRecoveryContract,
    guardianCom: Uint8Array,
): Promise<void> => {
    logger.info('Removing guardian...');
    const result = await contract.callTx.removeGuardian(guardianCom);
    logger.info(`removeGuardian tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const storeSharesCidHash = async (
    contract: DeployedGuardianRecoveryContract,
    cidHash: Uint8Array,
): Promise<void> => {
    logger.info('Storing shares CID hash...');
    const result = await contract.callTx.storeSharesCidHash(cidHash);
    logger.info(`storeSharesCidHash tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const initiateRecovery = async (
    contract: DeployedGuardianRecoveryContract,
    currentTime: bigint,
): Promise<void> => {
    logger.info(`Initiating recovery (time=${currentTime})...`);
    const result = await contract.callTx.initiateRecovery(currentTime);
    logger.info(`initiateRecovery tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const approveRecovery = async (contract: DeployedGuardianRecoveryContract): Promise<void> => {
    logger.info('Approving recovery...');
    const result = await contract.callTx.approveRecovery();
    logger.info(`approveRecovery tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const claimRecovery = async (contract: DeployedGuardianRecoveryContract): Promise<void> => {
    logger.info('Claiming recovery...');
    const result = await contract.callTx.claimRecovery();
    logger.info(`claimRecovery tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const cancelRecovery = async (contract: DeployedGuardianRecoveryContract): Promise<void> => {
    logger.info('Cancelling recovery...');
    const result = await contract.callTx.cancelRecovery();
    logger.info(`cancelRecovery tx ${result.public.txId} in block ${result.public.blockHeight}`);
};

export const getGuardianRecoveryLedgerState = async (
    providers: GuardianRecoveryProviders,
    contractAddress: ContractAddress,
): Promise<{
    owner: Uint8Array;
    guardianCount: bigint;
    recoveryInitiatedAt: bigint;
    sharesCidHash: Uint8Array;
    recoveryComplete: boolean;
    guardiansEmpty: boolean;
    approvedGuardiansEmpty: boolean;
} | null> => {
    assertIsContractAddress(contractAddress);
    logger.info('Checking GuardianRecovery ledger state...');
    const state = await providers.publicDataProvider.queryContractState(contractAddress).then((contractState) => {
        if (contractState == null) return null;
        const ledgerState = GuardianRecovery.ledger(contractState.data);
        return {
            owner: ledgerState.owner,
            guardianCount: ledgerState.guardianCount,
            recoveryInitiatedAt: ledgerState.recoveryInitiatedAt,
            sharesCidHash: ledgerState.sharesCidHash,
            recoveryComplete: ledgerState.recoveryComplete,
            guardiansEmpty: ledgerState.guardians.isEmpty(),
            approvedGuardiansEmpty: ledgerState.approvedGuardians.isEmpty(),
        };
    });
    logger.info(`GuardianRecovery state: guardianCount=${state?.guardianCount ?? 'N/A'}`);
    return state;
};
