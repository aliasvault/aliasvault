import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import type { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import type { EnvConfig } from '../config/env.js';

export interface WalletAndMidnightProvider {
  getCoinPublicKey: () => string;
  getEncryptionPublicKey: () => string;
  balanceTx: (tx: any, newCoins: any, ttl: any) => Promise<any>;
  submitTx: (tx: any) => Promise<any>;
}

export function createWalletAndMidnightProvider(wallet: WalletFacade): WalletAndMidnightProvider {
  return {
    getCoinPublicKey: () => wallet.coinPublicKey,
    getEncryptionPublicKey: () => wallet.encryptionPublicKey,
    balanceTx: (tx, newCoins, ttl) => wallet.balanceTransaction(tx, newCoins, ttl),
    submitTx: (tx) => wallet.submitTransaction(tx),
  };
}

export async function configureProviders(wallet: WalletFacade, config: EnvConfig) {
  const walletAndMidnightProvider = createWalletAndMidnightProvider(wallet);

  const zkConfigProvider = new NodeZkConfigProvider(config.vaultRegistryZkConfigPath);

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'smtp-bridge-private-state',
      walletProvider: walletAndMidnightProvider,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexerUrl, config.indexerWsUrl),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServerUrl, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
}
