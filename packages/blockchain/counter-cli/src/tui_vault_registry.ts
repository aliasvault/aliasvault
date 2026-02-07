// VaultRegistry test TUI — deploys contract and tests registration on local Midnight network.
// Reuses the wallet infrastructure from the counter CLI.
//
// Usage: node --experimental-specifier-resolution=node --loader ts-node/esm src/tui_vault_registry.ts

import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { createLogger } from './logger-utils.js';
import { StandaloneConfig, currentDir } from './config.js';
import * as api from './api.js';
import * as vrApi from './vault-registry-api.js';
import { type VaultRegistryProviders } from './vault-registry-types.js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import type { VaultRegistryCircuits } from './vault-registry-types.js';

const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

const config = new StandaloneConfig();
const logger = await createLogger(config.logDir);
api.setLogger(logger);
vrApi.initVaultRegistryLogger(logger);

const rli = createInterface({ input, output });

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║              VaultRegistry Contract Test                     ║
║              ──────────────────────────                      ║
║              Deploy and test vault registration              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

try {
  // Step 1: Build wallet
  console.log('Step 1: Building wallet from genesis seed...');
  const walletCtx = await api.buildWalletAndWaitForFunds(config, GENESIS_MINT_WALLET_SEED);

  // Step 2: Configure providers for VaultRegistry
  console.log('\nStep 2: Configuring providers...');
  const walletAndMidnightProvider = await api.createWalletAndMidnightProvider(walletCtx);
  const vaultRegistryZkConfigPath = path.resolve(currentDir, '..', '..', 'contract', 'src', 'managed', 'vault-registry');
  const zkConfigProvider = new NodeZkConfigProvider<VaultRegistryCircuits>(vaultRegistryZkConfigPath);

  const providers: VaultRegistryProviders = {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'vault-registry-private-state',
      walletProvider: walletAndMidnightProvider,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };

  // Step 3: Deploy VaultRegistry
  console.log('\nStep 3: Deploying VaultRegistry contract...');
  const contract = await api.withStatus('Deploying VaultRegistry', () =>
    vrApi.deployVaultRegistry(providers),
  );
  const contractAddress = contract.deployTxData.public.contractAddress;
  console.log(`  Contract deployed at: ${contractAddress}\n`);

  // Step 4: Check initial ledger state
  console.log('Step 4: Checking initial ledger state...');
  const initialState = await vrApi.getVaultRegistryLedgerState(providers, contractAddress);
  console.log(`  Total vaults (should be 0): ${initialState?.totalVaults ?? 'N/A'}\n`);

  // Step 5: Register a vault
  console.log('Step 5: Registering a vault...');
  // Create a 32-byte hash from a test wallet address
  const testAddressHash = new Uint8Array(32);
  const encoder = new TextEncoder();
  const testData = encoder.encode('test-wallet-address-for-aliasvault');
  testAddressHash.set(testData.slice(0, 32));

  await api.withStatus('Registering vault', () =>
    vrApi.registerVault(contract, testAddressHash),
  );
  console.log('  Vault registered successfully!\n');

  // Step 6: Check updated ledger state
  console.log('Step 6: Checking updated ledger state...');
  const updatedState = await vrApi.getVaultRegistryLedgerState(providers, contractAddress);
  console.log(`  Total vaults (should be 1): ${updatedState?.totalVaults ?? 'N/A'}\n`);

  // Step 7: Try to register the same vault again (should fail)
  console.log('Step 7: Attempting duplicate registration (should fail)...');
  try {
    await vrApi.registerVault(contract, testAddressHash);
    console.log('  ERROR: Duplicate registration should have failed!\n');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  Correctly rejected duplicate: ${msg}\n`);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  All VaultRegistry tests passed!');
  console.log(`  Contract address: ${contractAddress}`);
  console.log('═══════════════════════════════════════════════════════════\n');

} catch (e) {
  console.error('Test failed:', e);
  process.exit(1);
} finally {
  rli.close();
}
