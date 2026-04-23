/**
 * Alias service for the browser extension.
 * Handles AliasRegistry contract interactions: claim, check availability, release.
 *
 * Architecture:
 * - AliasRegistry is a singleton global contract (one address for all users)
 * - Uses dynamic imports (Rule 19) for all @aliasvault/contract and @midnight-ntwrk/* packages
 * - Alias hashing: SHA-256("localPart@domain") → Bytes<32>
 * - Owner commitment uses "alias:owner:" domain separator (different from VaultRegistry's "vault:owner:")
 */

import { CONTRACTS } from '../../../../shared/config/contracts';
import { getWalletNetworkConfig } from '../entrypoints/popup/config/networkConfig';
import { hashAlias } from '../utils/aliasUtils';
import { createMidnightProviders } from './providers/createMidnightProviders';

function getAliasRegistryAddress(): string {
  const address = CONTRACTS.AliasRegistry.address;
  if (!address) {
    throw new Error(
      'AliasRegistry contract address not configured. ' +
      'Set it in shared/config/contracts.ts.'
    );
  }
  return address;
}

/**
 * Join the AliasRegistry contract for write operations.
 * Follows the same pattern as MidnightContractService.joinVaultRegistry().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function joinAliasRegistry(secretKey: Uint8Array): Promise<any> {
  const { findDeployedContract } = await import('@midnight-ntwrk/midnight-js-contracts');
  const {
    AliasRegistry,
    aliasRegistryWitnesses,
    createAliasRegistryPrivateState,
  } = await import('@aliasvault/contract');
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');

  const compiledContract = CompiledContract.make(
    'alias-registry',
    AliasRegistry.Contract,
  ).pipe(CompiledContract.withWitnesses(aliasRegistryWitnesses));

  // Prefer wallet-provided service URIs (AC3) — falls back to hardcoded config
  // if no wallet is connected. See networkConfig.getWalletNetworkConfig.
  const defaults = await getWalletNetworkConfig();
  const providers = await createMidnightProviders(
    defaults.indexerUrl, defaults.wsIndexerUrl, defaults.proofServerUrl,
  );

  return findDeployedContract(providers, {
    contractAddress: getAliasRegistryAddress(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compiledContract: compiledContract as any,
    privateStateId: 'aliasRegistryPrivateState',
    initialPrivateState: createAliasRegistryPrivateState(secretKey),
  });
}

/**
 * Claim an alias on the AliasRegistry contract.
 * Hashes aliasName@alias.id via SHA-256, then calls claimAlias circuit.
 *
 * @param aliasName - Local part of the alias (e.g., "zk-tiger-7842")
 * @param secretKey - Owner's 32-byte secret key
 * @param vaultContractAddr - Owner's VaultRegistry contract address
 */
export async function claimAlias(
  aliasName: string,
  secretKey: Uint8Array,
  vaultContractAddr: string,
): Promise<void> {
  const aliasHash = await hashAlias(aliasName);
  const contract = await joinAliasRegistry(secretKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (contract as any).callTx.claimAlias(aliasHash, vaultContractAddr);
}

/**
 * Check if an alias name is available (unclaimed) on the AliasRegistry.
 * Uses indexer read-only query — no contract join or wallet signature needed.
 *
 * @param aliasName - Local part of the alias to check
 * @returns true if alias is available (unclaimed), false if taken
 */
export async function checkAliasAvailable(aliasName: string): Promise<boolean> {
  const { indexerPublicDataProvider } = await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  );
  const { AliasRegistry } = await import('@aliasvault/contract');

  const contractAddress = getAliasRegistryAddress();
  // Read-only indexer query — prefer wallet-provided URIs if available (AC3)
  const config = await getWalletNetworkConfig();
  const provider = indexerPublicDataProvider(config.indexerUrl, config.wsIndexerUrl);
  const contractState = await provider.queryContractState(contractAddress);

  if (!contractState) {
    // Contract not deployed yet — all aliases are available
    return true;
  }

  const aliasHash = await hashAlias(aliasName);
  const ledgerState = AliasRegistry.ledger(contractState.data);

  // Use member() check — lookup() throws for non-existent keys in simulator
  try {
    return !ledgerState.aliasOwners.member(aliasHash);
  } catch {
    // If member() fails (e.g., key format issue), treat as available
    return true;
  }
}

/**
 * Release an alias on the AliasRegistry contract.
 * Only the alias owner can release. For future use by Story 5.8.
 *
 * @param aliasName - Local part of the alias to release
 * @param secretKey - Owner's 32-byte secret key
 */
export async function releaseAlias(
  aliasName: string,
  secretKey: Uint8Array,
): Promise<void> {
  const aliasHash = await hashAlias(aliasName);
  const contract = await joinAliasRegistry(secretKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (contract as any).callTx.releaseAlias(aliasHash);
}
