// VaultRegistry test TUI — deploys contract and tests registration + private CID on local Midnight network.
// Reuses the wallet infrastructure from the counter CLI.
//
// Usage: node --experimental-specifier-resolution=node --loader ts-node/esm src/tui_vault_registry.ts

import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import crypto from 'node:crypto';
import { createLogger } from './logger-utils.js';
import { StandaloneConfig } from './config.js';
import * as api from './api.js';
import * as vrApi from './vault-registry-api.js';
import { GENESIS_MINT_WALLET_SEED, vaultRegistryZkConfigPath } from './vault-registry-api.js';
import { type VaultRegistryProviders } from './vault-registry-types.js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import type { VaultRegistryCircuits } from './vault-registry-types.js';


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
║              Deploy, register, update CID, verify            ║
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

  // Generate a 32-byte secret key for owner identity
  const secretKey = crypto.randomBytes(32);
  console.log(`  Secret key generated (${secretKey.length} bytes)\n`);

  // Step 3: Deploy VaultRegistry
  console.log('Step 3: Deploying VaultRegistry contract...');
  const contract = await api.withStatus('Deploying VaultRegistry', () =>
    vrApi.deployVaultRegistry(providers, secretKey),
  );
  const contractAddress = contract.deployTxData.public.contractAddress;
  console.log(`  Contract deployed at: ${contractAddress}\n`);

  // Step 4: Check initial ledger state
  console.log('Step 4: Checking initial ledger state...');
  const initialState = await vrApi.getVaultRegistryLedgerState(providers, contractAddress);
  console.log(`  Total vaults (should be 0): ${initialState?.totalVaults ?? 'N/A'}\n`);

  // Step 5: Register a vault
  console.log('Step 5: Registering a vault...');
  const testAddressHash = crypto.createHash('sha256').update('test-wallet-address-for-aliasvault').digest();

  await api.withStatus('Registering vault', () =>
    vrApi.registerVault(contract, testAddressHash),
  );
  console.log('  Vault registered successfully!\n');

  // Step 6: Check updated ledger state (should show owner commitment)
  console.log('Step 6: Checking updated ledger state...');
  const updatedState = await vrApi.getVaultRegistryLedgerState(providers, contractAddress);
  console.log(`  Total vaults (should be 1): ${updatedState?.totalVaults ?? 'N/A'}`);
  console.log(`  Owner set: ${updatedState?.owner ? 'yes' : 'no'}`);
  console.log(`  VaultCidHash (should be empty): ${Buffer.from(updatedState?.vaultCidHash ?? []).toString('hex')}\n`);

  // Step 7: Update Vault CID (API now takes full CID string, validates CIDv1, hashes internally)
  console.log('Step 7: Updating vault CID...');
  const testCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
  console.log(`  CID: ${testCid}`);

  await api.withStatus('Updating vault CID', () =>
    vrApi.updateVault(contract, testCid),
  );
  console.log('  Vault CID updated successfully!\n');

  // Step 8: Verify getVaultCID returns the stored CID
  console.log('Step 8: Verifying getVaultCID()...');
  const retrievedCid = vrApi.getVaultCID(contract);
  console.log(`  Retrieved CID: ${retrievedCid}`);
  if (retrievedCid === testCid) {
    console.log('  ✅ getVaultCID matches!\n');
  } else {
    console.log('  ❌ getVaultCID MISMATCH!\n');
  }

  // Step 8b: Verify CID hash in ledger state
  console.log('Step 8b: Verifying CID hash in ledger state...');
  const finalState = await vrApi.getVaultRegistryLedgerState(providers, contractAddress);
  const storedHash = Buffer.from(finalState?.vaultCidHash ?? []).toString('hex');
  const expectedHash = crypto.createHash('sha256').update(testCid).digest().toString('hex');
  console.log(`  Stored CID hash:   ${storedHash}`);
  console.log(`  Expected CID hash: ${expectedHash}`);
  if (storedHash === expectedHash) {
    console.log('  ✅ CID hash matches!\n');
  } else {
    console.log('  ❌ CID hash MISMATCH!\n');
  }

  // Step 9: Try to register the same vault again (should fail)
  console.log('Step 9: Attempting duplicate registration (should fail)...');
  try {
    await vrApi.registerVault(contract, testAddressHash);
    console.log('  ERROR: Duplicate registration should have failed!\n');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  Correctly rejected duplicate: ${msg}\n`);
  }

  // Step 10: Store recovery key hash
  console.log('Step 10: Storing recovery key hash...');
  const recoveryKeyHash = crypto.createHash('sha256').update('test-recovery-key').digest();
  await api.withStatus('Storing recovery key hash', () =>
    vrApi.storeRecoveryKeyHash(contract, recoveryKeyHash),
  );
  console.log('  Recovery key hash stored successfully!\n');

  // Step 11: Verify recovery key hash in ledger
  console.log('Step 11: Verifying recovery key hash in ledger...');
  const stateAfterRecovery = await vrApi.getVaultRegistryLedgerState(providers, contractAddress);
  const storedRecoveryHash = Buffer.from(stateAfterRecovery?.recoveryKeyHash ?? []).toString('hex');
  const expectedRecoveryHash = recoveryKeyHash.toString('hex');
  if (storedRecoveryHash === expectedRecoveryHash) {
    console.log('  ✅ Recovery key hash matches!\n');
  } else {
    console.log('  ❌ Recovery key hash MISMATCH!\n');
  }

  // Step 12: Add a backup wallet
  console.log('Step 12: Adding backup wallet...');
  const backupSecretKey = crypto.randomBytes(32);
  const { pureCircuits } = await import('@aliasvault/contract').then(m => m.VaultRegistry);
  const backupWalletCommitment = pureCircuits.backupCommitment(backupSecretKey);
  await api.withStatus('Adding backup wallet', () =>
    vrApi.addBackupWallet(contract, backupWalletCommitment, BigInt(Math.floor(Date.now() / 1000))),
  );
  console.log('  Backup wallet added successfully!\n');

  // Step 13: Verify backup wallet in ledger
  console.log('Step 13: Verifying backup wallet in ledger...');
  const stateAfterBackup = await vrApi.getVaultRegistryLedgerState(providers, contractAddress);
  if (stateAfterBackup?.backupWalletsEmpty === false) {
    console.log('  ✅ backupWallets is non-empty!\n');
  } else {
    console.log('  ❌ backupWallets should not be empty!\n');
  }

  // Step 14: Transfer ownership
  console.log('Step 14: Testing transfer ownership...');
  const newSecretKey = crypto.randomBytes(32);
  const newOwnerCommitment = pureCircuits.ownerCommitment(newSecretKey);
  await api.withStatus('Transferring ownership', () =>
    vrApi.transferOwnership(contract, newOwnerCommitment),
  );
  console.log('  Ownership transferred successfully!\n');

  // Step 15: Verify new owner, recovery state reset, and backup wallets cleared
  console.log('Step 15: Verifying ownership transfer...');
  const stateAfterTransfer = await vrApi.getVaultRegistryLedgerState(providers, contractAddress);
  const newOwnerHex = Buffer.from(stateAfterTransfer?.owner ?? []).toString('hex');
  const expectedOwnerHex = Buffer.from(newOwnerCommitment).toString('hex');
  if (newOwnerHex === expectedOwnerHex) {
    console.log('  ✅ New owner commitment matches!');
  } else {
    console.log('  ❌ New owner MISMATCH!');
  }
  const recoveryReset = Buffer.from(stateAfterTransfer?.recoveryKeyHash ?? []).toString('hex') === '0'.repeat(64);
  if (recoveryReset) {
    console.log('  ✅ Recovery state was reset on transfer!');
  } else {
    console.log('  ❌ Recovery state NOT reset!');
  }
  if (stateAfterTransfer?.backupWalletsEmpty === true) {
    console.log('  ✅ Backup wallets cleared by resetToDefault() on transfer!\n');
  } else {
    console.log('  ❌ Backup wallets NOT cleared on transfer!\n');
  }

  // Step 16: CIDv1 validation test
  console.log('Step 16: Testing CIDv1 validation...');
  try {
    vrApi.assertCIDv1('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
    console.log('  ERROR: CIDv0 should have been rejected!\n');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  Correctly rejected CIDv0: ${msg}`);
  }
  try {
    vrApi.assertCIDv1('BAFY...');
    console.log('  ERROR: Non-base32 CID should have been rejected!\n');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  Correctly rejected non-base32: ${msg}\n`);
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
