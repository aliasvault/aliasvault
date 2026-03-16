#!/usr/bin/env node
// Headless VaultRegistry deployment script.
// Usage: node --experimental-specifier-resolution=node --loader ts-node/esm src/deploy-vault-registry.ts [--network=local|preview|preprod] [--seed=<hex>] [--dry-run]

import path from 'node:path';
import { createLogger } from './logger-utils.js';
import { StandaloneConfig, PreviewConfig, PreprodConfig, currentDir } from './config.js';
import * as api from './api.js';
import * as vrApi from './vault-registry-api.js';
import { GENESIS_MINT_WALLET_SEED, vaultRegistryZkConfigPath } from './vault-registry-api.js';
import { type VaultRegistryProviders } from './vault-registry-types.js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import type { VaultRegistryCircuits } from './vault-registry-types.js';
import { parseDeployArgs, deriveSecretKey, updateContractsConfig } from './deploy-utils.js';

async function main(): Promise<void> {
  const args = parseDeployArgs(process.argv.slice(2));

  // Resolve seed: --seed flag, or genesis for local
  const seed = args.seed ?? (args.network === 'local' ? GENESIS_MINT_WALLET_SEED : undefined);
  if (!seed) {
    console.error('Error: --seed is required for preview/preprod networks.');
    process.exit(1);
  }

  // Select config class
  const ConfigClass = { local: StandaloneConfig, preview: PreviewConfig, preprod: PreprodConfig }[args.network];
  const config = new ConfigClass();
  const logger = await createLogger(config.logDir);
  api.setLogger(logger);
  vrApi.initVaultRegistryLogger(logger);

  console.log(`Deploying VaultRegistry to ${args.network} network...`);

  // Build wallet
  const walletCtx = await api.buildWalletAndWaitForFunds(config, seed);

  // Configure VaultRegistry providers (same pattern as tui_vault_registry.ts:46-61)
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

  // Derive deterministic secret key from seed
  const secretKey = deriveSecretKey(seed);
  console.log(`Secret key derived (deterministic from seed + domain separator)`);

  // Deploy
  const contract = await api.withStatus('Deploying VaultRegistry', () =>
    vrApi.deployVaultRegistry(providers, secretKey),
  );
  const contractAddress = contract.deployTxData.public.contractAddress;
  console.log(`\nVaultRegistry deployed at: ${contractAddress}`);

  // Write to shared config (unless --dry-run)
  if (!args.dryRun) {
    const configPath = path.resolve(currentDir, '..', '..', '..', '..', 'shared', 'config', 'contracts.ts');
    updateContractsConfig(configPath, contractAddress, 'VaultRegistry', args.network);
    console.log(`Updated shared/config/contracts.ts → VaultRegistry.address = "${contractAddress}"`);
  } else {
    console.log('--dry-run: skipping shared/config/contracts.ts update');
  }

  // Final line: raw address for CI/CD consumption (e.g. `deploy-local | tail -1`)
  console.log(contractAddress);
  process.exit(0);
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
