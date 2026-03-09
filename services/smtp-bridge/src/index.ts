import { WebSocket } from 'ws';
// Required: Polyfill WebSocket for Node.js (Midnight wallet SDK requires it)
(globalThis as any).WebSocket = WebSocket;

import { loadEnv } from './config/env.js';
import { createApp } from './app.js';
import { initWallet } from './midnight/wallet.js';
import { configureProviders } from './midnight/providers.js';
import {
  deriveRelayCommitment,
  lookupAliasVaultAddress,
  readEmailPublicKeyFromIndexer,
  readInboxManifestCidFromIndexer,
  callNotifyNewMail,
} from './midnight/contracts.js';
import { AliasLookupService } from './services/aliasLookup.js';
import { EmailKeyLookupService } from './services/emailKeyLookup.js';
import { EmailEncryptor } from './services/emailEncryptor.js';
import { ManifestManager } from './services/manifestManager.js';
import { NotificationQueue } from './services/notificationQueue.js';
import { IpfsService, PinataProvider } from '@aliasvault/ipfs-service';
import type { BridgeContext } from './types/context.js';

async function main() {
  const config = loadEnv();
  console.log(`[smtp-bridge] Starting on port ${config.port}...`);

  // Derive and log relay commitment for operator verification
  const relayKeyBytes = Buffer.from(config.relaySecretKey, 'hex');
  const relayCommitment = deriveRelayCommitment(relayKeyBytes);
  console.log(`[smtp-bridge] Relay commitment: ${Buffer.from(relayCommitment).toString('hex')}`);

  // Init wallet
  console.log('[smtp-bridge] Initializing Midnight wallet...');
  const wallet = await initWallet(config);
  console.log('[smtp-bridge] Wallet initialized.');

  // Configure providers (6-provider stack for contract operations)
  console.log('[smtp-bridge] Configuring providers...');
  const providers = await configureProviders(wallet, config);
  console.log('[smtp-bridge] Providers configured.');

  // IPFS
  const pinataProvider = new PinataProvider({
    pinataJwt: config.pinataJwt,
    pinataGateway: config.pinataGateway,
  });
  const ipfs = new IpfsService(pinataProvider);

  // Services
  const aliasLookup = new AliasLookupService(config);
  const emailKeyLookup = new EmailKeyLookupService(config);
  const emailEncryptor = new EmailEncryptor();
  const manifestManager = new ManifestManager(ipfs);
  const notificationQueue = new NotificationQueue(config);

  // Wire contract query functions using configured providers
  aliasLookup.setQueryFn(async (aliasHash) =>
    lookupAliasVaultAddress(providers.publicDataProvider, config.aliasRegistryAddress, aliasHash),
  );

  emailKeyLookup.setQueryFn(async (contractAddress) =>
    readEmailPublicKeyFromIndexer(providers.publicDataProvider, contractAddress),
  );

  notificationQueue.setNotifyFn(async (contractAddress, manifestCid) =>
    callNotifyNewMail(providers, contractAddress, manifestCid, relayKeyBytes),
  );

  const ctx: BridgeContext = {
    config,
    aliasLookup,
    emailKeyLookup,
    emailEncryptor,
    manifestManager,
    notificationQueue,
    ipfs,
    walletReady: true,
    readInboxManifestCid: async (contractAddress) =>
      readInboxManifestCidFromIndexer(providers.publicDataProvider, contractAddress),
    checkIndexerHealth: async () => {
      try {
        await providers.publicDataProvider.queryContractState(config.aliasRegistryAddress);
        return true;
      } catch {
        return false;
      }
    },
  };

  const app = createApp(ctx);

  const server = app.listen(config.port, () => {
    console.log(`[smtp-bridge] Listening on port ${config.port}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[smtp-bridge] Shutting down...');
    notificationQueue.stop();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[smtp-bridge] Fatal error:', err);
  process.exit(1);
});
