// This file is part of midnightntwrk/example-counter.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { Counter, type CounterPrivateState, witnesses } from '@aliasvault/contract';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { type FinalizedTxData, type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles, generateRandomSeed } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
    createKeystore,
    InMemoryTransactionHistoryStorage,
    PublicKey,
    UnshieldedWallet,
    type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import {
    type CounterCircuits,
    type CounterContract,
    type CounterPrivateStateId,
    type CounterProviders,
    type DeployedCounterContract,
} from './common-types';
import { type Config, contractConfig } from './config';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { assertIsContractAddress, toHex } from '@midnight-ntwrk/midnight-js-utils';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { Buffer } from 'buffer';
import {
    MidnightBech32m,
    ShieldedAddress,
    ShieldedCoinPublicKey,
    ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';

let logger: Logger;

// Required for GraphQL subscriptions (wallet sync) to work in Node.js
// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// Pre-compile the counter contract with ZK circuit assets
const counterCompiledContract = CompiledContract.make('counter', Counter.Contract).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

export interface WalletContext {
    wallet: WalletFacade;
    shieldedSecretKeys: ledger.ZswapSecretKeys;
    dustSecretKey: ledger.DustSecretKey;
    unshieldedKeystore: UnshieldedKeystore;
}

export const getCounterLedgerState = async (
    providers: CounterProviders,
    contractAddress: ContractAddress,
): Promise<bigint | null> => {
    assertIsContractAddress(contractAddress);
    logger.info('Checking contract ledger state...');
    const state = await providers.publicDataProvider
        .queryContractState(contractAddress)
        .then((contractState) => (contractState != null ? Counter.ledger(contractState.data).round : null));
    logger.info(`Ledger state: ${state}`);
    return state;
};

export const counterContractInstance: CounterContract = new Counter.Contract(witnesses);

export const joinContract = async (
    providers: CounterProviders,
    contractAddress: string,
): Promise<DeployedCounterContract> => {
    const counterContract = await findDeployedContract(providers, {
        contractAddress,
        compiledContract: counterCompiledContract,
        privateStateId: 'counterPrivateState',
        initialPrivateState: { privateCounter: 0 },
    });
    logger.info(`Joined contract at address: ${counterContract.deployTxData.public.contractAddress}`);
    return counterContract;
};

export const deploy = async (
    providers: CounterProviders,
    privateState: CounterPrivateState,
): Promise<DeployedCounterContract> => {
    logger.info('Deploying counter contract...');
    const counterContract = await deployContract(providers, {
        compiledContract: counterCompiledContract,
        privateStateId: 'counterPrivateState',
        initialPrivateState: privateState,
    });
    logger.info(`Deployed contract at address: ${counterContract.deployTxData.public.contractAddress}`);
    return counterContract;
};

export const increment = async (counterContract: DeployedCounterContract): Promise<FinalizedTxData> => {
    logger.info('Incrementing...');
    const finalizedTxData = await counterContract.callTx.increment();
    logger.info(`Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`);
    return finalizedTxData.public;
};

export const displayCounterValue = async (
    providers: CounterProviders,
    counterContract: DeployedCounterContract,
): Promise<{ counterValue: bigint | null; contractAddress: string }> => {
    const contractAddress = counterContract.deployTxData.public.contractAddress;
    const counterValue = await getCounterLedgerState(providers, contractAddress);
    if (counterValue === null) {
        logger.info(`There is no counter contract deployed at ${contractAddress}.`);
    } else {
        logger.info(`Current counter value: ${Number(counterValue)}`);
    }
    return { contractAddress, counterValue };
};

/**
 * Create the unified WalletProvider & MidnightProvider for midnight-js.
 * This bridges the wallet-sdk-facade to the midnight-js contract API by
 * implementing balance, sign, finalize, and submit operations.
 */
export const createWalletAndMidnightProvider = async (
    ctx: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
    const state = await firstSyncedState(ctx.wallet);
    return {
        getCoinPublicKey() {
            return state.shielded.coinPublicKey.toHexString();
        },
        getEncryptionPublicKey() {
            return state.shielded.encryptionPublicKey.toHexString();
        },
        async balanceTx(tx, ttl?) {
            const recipe = await ctx.wallet.balanceUnboundTransaction(
                tx,
                { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
                { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
            );

            // Sign the recipe (base + any balancing tx) with the unshielded keystore.
            // wallet-sdk@4 signRecipe handles both proof markers internally, so the
            // old manual signTransactionIntents workaround is no longer needed.
            const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
            const signedRecipe = await ctx.wallet.signRecipe(recipe, signFn);

            return ctx.wallet.finalizeRecipe(signedRecipe);
        },
        submitTx(tx) {
            return ctx.wallet.submitTransaction(tx);
        },
    };
};

// Max time to wait for the wallet to sync against a local devnet before failing.
// A fresh undeployed stack with 1s blocks normally syncs in seconds; this is a
// safety bound so a stuck sync fails fast instead of hanging the whole run.
const WALLET_SYNC_TIMEOUT_MS = 5 * 60 * 1000;
// Dust generation (NIGHT → DUST) takes several blocks after on-chain registration,
// so its wait gets a larger bound than plain sync.
const DUST_GENERATION_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Whether one sub-wallet's SyncProgress is "done". `isStrictlyComplete()` requires
 * `isConnected && applied === highest`. On a fresh undeployed devnet, a sub-wallet
 * with no relevant history (e.g. shielded/dust for the genesis wallet) sits at 0/0
 * and may never report `isConnected`, which would hang sync forever — so we also
 * accept the 0/0 "nothing to sync" case. The shielded/dust sub-wallets use v2
 * SyncProgress (`appliedIndex`/`highestRelevantWalletIndex`); unshielded uses v1
 * (`appliedId`/`highestTransactionId`) — so we check both field shapes.
 *
 * CAVEAT: the 0/0 path intentionally ignores `isConnected`. On a network with real
 * history this could in principle resolve on a pre-sync 0/0 snapshot; in the CLI
 * flows the `balance > 0n` filter in waitForFunds/waitForDust is the funded-read
 * backstop. Re-verify these gates against a funded preview/preprod wallet before
 * relying on them for any non-local deploy. (See story 6.5c review issue #3.)
 */
const isProgressSynced = (progress: any): boolean => {
    if (progress.isStrictlyComplete()) return true;
    const applied = progress.appliedIndex ?? progress.appliedId;
    const target = progress.highestRelevantWalletIndex ?? progress.highestTransactionId;
    return applied === 0n && target === 0n;
};

/** 0/0-aware equivalent of FacadeState.isSynced across all three sub-wallets. */
const isWalletSynced = (state: any): boolean =>
    isProgressSynced(state.shielded.state.progress) &&
    isProgressSynced(state.dust.state.progress) &&
    isProgressSynced(state.unshielded.progress);

/**
 * Resolve once the wallet reports synced, bounded by a timeout so a stuck sync fails
 * fast. ALL single-shot "get a synced state" reads must go through this rather than a
 * bare firstValueFrom(filter(isWalletSynced)), which can hang forever.
 */
const firstSyncedState = (wallet: WalletFacade, timeoutMs = WALLET_SYNC_TIMEOUT_MS) =>
    Rx.firstValueFrom(
        wallet.state().pipe(
            Rx.throttleTime(2_000),
            Rx.filter((state) => isWalletSynced(state)),
            Rx.timeout({
                each: timeoutMs,
                with: () => Rx.throwError(() => new Error(`Wallet sync timed out after ${timeoutMs}ms`)),
            }),
        ),
    );

/** Wait (bounded) until the wallet has a non-zero DUST balance. */
const waitForDust = (wallet: WalletFacade) =>
    Rx.firstValueFrom(
        wallet.state().pipe(
            Rx.throttleTime(5_000),
            Rx.filter((s) => isWalletSynced(s)),
            Rx.filter((s) => s.dust.balance(new Date()) > 0n),
            Rx.timeout({
                each: DUST_GENERATION_TIMEOUT_MS,
                with: () =>
                    Rx.throwError(() => new Error(`Dust generation timed out after ${DUST_GENERATION_TIMEOUT_MS}ms`)),
            }),
        ),
    );

/** Wait until the wallet has fully synced with the network. Returns the synced state. */
export const waitForSync = (wallet: WalletFacade) => firstSyncedState(wallet);

/** Wait until the wallet has a non-zero unshielded balance. Returns the balance. */
export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
    Rx.firstValueFrom(
        wallet.state().pipe(
            Rx.throttleTime(5_000),
            Rx.filter((state) => isWalletSynced(state)),
            Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
            Rx.filter((balance) => balance > 0n),
            Rx.timeout({
                each: WALLET_SYNC_TIMEOUT_MS,
                with: () => Rx.throwError(() => new Error('Timed out waiting for incoming funds')),
            }),
        ),
    );

// wallet-sdk v4 unified the three per-sub-wallet configs into a single merged
// configuration consumed by WalletFacade.init. provingServerUrl + relayURL are now
// facade/capability-level (proving + submission services); txHistoryStorage is shared
// by all three sub-wallets. (Matches the EffectStream reference for this stack.)
const buildWalletConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
    networkId: getNetworkId(),
    indexerClientConnection: {
        indexerHttpUrl: indexer,
        indexerWsUrl: indexerWS,
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    costParameters: {
        additionalFeeOverhead: 300_000_000_000_000n,
        feeBlocksMargin: 5,
    },
    relayURL: new URL(node.replace(/^http/, 'ws')),
    provingServerUrl: new URL(proofServer),
});

/**
 * Derive HD wallet keys for all three roles (Zswap, NightExternal, Dust)
 * from a hex-encoded seed using BIP-44 style derivation at account 0, index 0.
 */
const deriveKeysFromSeed = (seed: string) => {
    const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
    if (hdWallet.type !== 'seedOk') {
        throw new Error('Failed to initialize HDWallet from seed');
    }

    const derivationResult = hdWallet.hdWallet
        .selectAccount(0)
        .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
        .deriveKeysAt(0);

    if (derivationResult.type !== 'keysDerived') {
        throw new Error('Failed to derive keys');
    }

    hdWallet.hdWallet.clear();
    return derivationResult.keys;
};

/**
 * Formats a token balance for display (e.g. 1000000000 -> "1,000,000,000").
 */
const formatBalance = (balance: bigint): string => balance.toLocaleString();

/**
 * Runs an async operation with an animated spinner on the console.
 * Shows ⠋⠙⠹... while running, then ✓ on success or ✗ on failure.
 */
export const withStatus = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const interval = setInterval(() => {
        process.stdout.write(`\r  ${frames[i++ % frames.length]} ${message}`);
    }, 80);
    try {
        const result = await fn();
        clearInterval(interval);
        process.stdout.write(`\r  ✓ ${message}\n`);
        return result;
    } catch (e) {
        clearInterval(interval);
        process.stdout.write(`\r  ✗ ${message}\n`);
        throw e;
    }
};

/**
 * Register unshielded NIGHT UTXOs for dust generation.
 *
 * On Preprod/Preview, NIGHT tokens generate DUST over time, but only after
 * the UTXOs have been explicitly designated for dust generation via an on-chain
 * transaction. DUST is the non-transferable fee token used by the Midnight network.
 */
const registerForDustGeneration = async (
    wallet: WalletFacade,
    unshieldedKeystore: UnshieldedKeystore,
): Promise<void> => {
    const state = await firstSyncedState(wallet);

    // Check if dust is already available (e.g. from a previous designation)
    if (state.dust.availableCoins.length > 0) {
        const dustBal = state.dust.balance(new Date());
        console.log(`  ✓ Dust tokens already available (${formatBalance(dustBal)} DUST)`);
        return;
    }

    // Only register coins that haven't been designated yet
    const nightUtxos = state.unshielded.availableCoins.filter(
        (coin: any) => coin.meta?.registeredForDustGeneration !== true,
    );
    if (nightUtxos.length === 0) {
        // All coins already registered — just wait for dust to generate
        await withStatus('Waiting for dust tokens to generate', () => waitForDust(wallet));
        return;
    }

    await withStatus(`Registering ${nightUtxos.length} NIGHT UTXO(s) for dust generation`, async () => {
        const recipe = await wallet.registerNightUtxosForDustGeneration(
            nightUtxos,
            unshieldedKeystore.getPublicKey(),
            (payload) => unshieldedKeystore.signData(payload),
        );
        const finalized = await wallet.finalizeRecipe(recipe);
        await wallet.submitTransaction(finalized);
    });

    // Wait for dust to actually generate (balance > 0), not just for coins to appear
    await withStatus('Waiting for dust tokens to generate', () =>
        Rx.firstValueFrom(
            wallet.state().pipe(
                Rx.throttleTime(5_000),
                Rx.filter((s) => isWalletSynced(s)),
                Rx.filter((s) => s.dust.balance(new Date()) > 0n),
            ),
        ),
    );
};

/**
 * Prints a formatted wallet summary to the console, showing all three
 * wallet types (Shielded, Unshielded, Dust) with their addresses and balances.
 */
const printWalletSummary = (seed: string, state: any, unshieldedKeystore: UnshieldedKeystore) => {
    const networkId = getNetworkId();
    const unshieldedBalance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;

    // Build the bech32m shielded address from coin + encryption public keys
    const coinPubKey = ShieldedCoinPublicKey.fromHexString(state.shielded.coinPublicKey.toHexString());
    const encPubKey = ShieldedEncryptionPublicKey.fromHexString(state.shielded.encryptionPublicKey.toHexString());
    const shieldedAddress = MidnightBech32m.encode(networkId, new ShieldedAddress(coinPubKey, encPubKey)).toString();

    const DIV = '──────────────────────────────────────────────────────────────';

    console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId}
${DIV}
  Seed: ${seed}
${DIV}

  Shielded (ZSwap)
  └─ Address: ${shieldedAddress}

  Unshielded
  ├─ Address: ${unshieldedKeystore.getBech32Address()}
  └─ Balance: ${formatBalance(unshieldedBalance)} tNight

  Dust
  └─ Address: ${MidnightBech32m.encode(networkId, state.dust.address).toString()}

${DIV}`);
};

/**
 * Build (or restore) a wallet from a hex seed, then wait for the wallet
 * to sync and receive funds before returning.
 *
 * Steps:
 *   1. Derive HD keys (Zswap, NightExternal, Dust) from the seed
 *   2. Create the three sub-wallets (Shielded, Unshielded, Dust)
 *   3. Start the WalletFacade and wait for sync
 *   4. Display a wallet summary with all addresses
 *   5. If balance is zero, wait for incoming funds (e.g. from faucet)
 */
export const buildWalletAndWaitForFunds = async (config: Config, seed: string): Promise<WalletContext> => {
    console.log('');

    // Derive HD keys and initialize the three sub-wallets
    const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await withStatus(
        'Building wallet',
        async () => {
            const keys = deriveKeysFromSeed(seed);
            const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
            const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
            const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

            // wallet-sdk v4: WalletFacade.init() is the static factory (the constructor
            // is private). It takes one merged configuration plus per-sub-wallet factory
            // functions. init() only CONSTRUCTS the sub-wallets — it does NOT begin chain
            // sync; we must call wallet.start() explicitly (which starts each sub-wallet's
            // sync + the pending-tx service). All packages are on ledger-v8, so no casts.
            const configuration = buildWalletConfig(config);
            const dustParameters = ledger.LedgerParameters.initialParameters().dust;

            const wallet = await WalletFacade.init({
                configuration,
                shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
                unshielded: (cfg) =>
                    UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
                dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, dustParameters),
            });

            // Begin chain sync for all three sub-wallets. Without this the wallet never
            // connects and sync (isConnected) never completes. Stop the wallet if start
            // fails so we don't leak the sub-wallet sync streams / capability services
            // (matters for the in-process test harness, which builds wallets repeatedly).
            try {
                await wallet.start(shieldedSecretKeys, dustSecretKey);
            } catch (e) {
                await wallet.stop().catch(() => {});
                throw e;
            }

            return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
        },
    );

    // Show seed and unshielded address immediately so user can fund via faucet while syncing
    const networkId = getNetworkId();
    const DIV = '──────────────────────────────────────────────────────────────';
    console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId}
${DIV}
  Seed: ${seed}

  Unshielded Address (send tNight here):
  ${unshieldedKeystore.getBech32Address()}

  Fund your wallet with tNight from the Preprod faucet:
  https://faucet.preprod.midnight.network/
${DIV}
`);

    // Wait for the wallet to sync with the network
    const syncedState = await withStatus('Syncing with network', () => waitForSync(wallet));

    // Display the full wallet summary with all addresses and balances
    printWalletSummary(seed, syncedState, unshieldedKeystore);

    // Check if wallet has funds; if not, wait for incoming tokens
    const balance = syncedState.unshielded.balances[unshieldedToken().raw] ?? 0n;
    if (balance === 0n) {
        const fundedBalance = await withStatus('Waiting for incoming tokens', () => waitForFunds(wallet));
        console.log(`    Balance: ${formatBalance(fundedBalance)} tNight\n`);
    }

    // Register NIGHT UTXOs for dust generation (required for tx fees on Preprod/Preview)
    await registerForDustGeneration(wallet, unshieldedKeystore);

    return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const buildFreshWallet = async (config: Config): Promise<WalletContext> =>
    await buildWalletAndWaitForFunds(config, toHex(Buffer.from(generateRandomSeed())));

// Midnight SDK v4: `levelPrivateStateProvider` no longer accepts `walletProvider`.
// Required fields are `accountId` (any unique per-wallet string — we use the coin
// public key hex) and `privateStoragePasswordProvider` (returns a password ≥16 chars
// used to encrypt the level-db store). For CLI/dev flows we default to a fixed
// password; production callers can override with `MIDNIGHT_PRIVATE_STATE_PASSWORD`.
// v4 levelPrivateStateProvider enforces password complexity: must contain at least
// 3 of {uppercase, lowercase, digit, special} and be >= 16 chars. This dev default
// satisfies all four; production overrides via MIDNIGHT_PRIVATE_STATE_PASSWORD.
const DEV_PRIVATE_STATE_PASSWORD = 'AliasVault-CLI-Dev-Password-DoNotUseInProduction-1';

export const buildPrivateStateProviderConfig = (walletProvider: WalletProvider, privateStateStoreName: string) => ({
    privateStateStoreName,
    accountId: walletProvider.getCoinPublicKey(),
    privateStoragePasswordProvider: async (): Promise<string> => {
        const envPassword = process.env.MIDNIGHT_PRIVATE_STATE_PASSWORD;
        if (envPassword) return envPassword;
        // The level-db private-state store encrypts contract secret keys at rest. The
        // built-in dev default is only acceptable on the local `undeployed` network —
        // refuse to silently protect any real network's data with it.
        if (String(getNetworkId()) !== 'undeployed') {
            throw new Error(
                'MIDNIGHT_PRIVATE_STATE_PASSWORD must be set for non-local networks: the ' +
                    'private-state store encrypts contract secret keys at rest and the built-in ' +
                    'dev default must not protect production data.',
            );
        }
        return DEV_PRIVATE_STATE_PASSWORD;
    },
});

/**
 * Configure all midnight-js providers needed for contract deployment and interaction.
 * This wires together the wallet, proof server, indexer, and private state storage.
 */
export const configureProviders = async (ctx: WalletContext, config: Config) => {
    const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
    const zkConfigProvider = new NodeZkConfigProvider<CounterCircuits>(contractConfig.zkConfigPath);
    return {
        privateStateProvider: levelPrivateStateProvider<typeof CounterPrivateStateId>(
            buildPrivateStateProviderConfig(walletAndMidnightProvider, contractConfig.privateStateStoreName),
        ),
        publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
        zkConfigProvider,
        proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
        walletProvider: walletAndMidnightProvider,
        midnightProvider: walletAndMidnightProvider,
    };
};

/**
 * Get the current DUST balance from the wallet state.
 */
export const getDustBalance = async (
    wallet: WalletFacade,
): Promise<{ available: bigint; pending: bigint; availableCoins: number; pendingCoins: number }> => {
    const state = await firstSyncedState(wallet);
    const available = state.dust.balance(new Date());
    const availableCoins = state.dust.availableCoins.length;
    const pendingCoins = state.dust.pendingCoins.length;
    // Sum pending coin initial values for a rough pending balance
    const pending = state.dust.pendingCoins.reduce((sum, c) => sum + c.initialValue, 0n);
    return { available, pending, availableCoins, pendingCoins };
};

/**
 * Monitor DUST balance with a live-updating display.
 * Prints a status line every 5 seconds showing balance, coins, and status.
 * Resolves when the user presses Enter (via the provided signal).
 */
export const monitorDustBalance = async (wallet: WalletFacade, stopSignal: Promise<void>): Promise<void> => {
    let stopped = false;
    void stopSignal.then(() => {
        stopped = true;
    });

    const sub = wallet
        .state()
        .pipe(
            Rx.throttleTime(5_000),
            Rx.filter((s) => isWalletSynced(s)),
        )
        .subscribe((state) => {
            if (stopped) return;

            const now = new Date();
            const available = state.dust.balance(now);
            const availableCoins = state.dust.availableCoins.length;
            const pendingCoins = state.dust.pendingCoins.length;

            const registeredNight = state.unshielded.availableCoins.filter(
                (coin: any) => coin.meta?.registeredForDustGeneration === true,
            ).length;
            const totalNight = state.unshielded.availableCoins.length;

            let status = '';
            if (pendingCoins > 0 && availableCoins === 0) {
                status = '⚠ locked by pending tx';
            } else if (available > 0n) {
                status = '✓ ready to deploy';
            } else if (availableCoins > 0) {
                status = 'accruing...';
            } else if (registeredNight > 0) {
                status = 'waiting for generation...';
            } else {
                status = 'no NIGHT registered';
            }

            const time = now.toLocaleTimeString();
            console.log(
                `  [${time}] DUST: ${formatBalance(available)} (${availableCoins} coins, ${pendingCoins} pending) | NIGHT: ${totalNight} UTXOs, ${registeredNight} registered | ${status}`,
            );
        });

    await stopSignal;
    sub.unsubscribe();
};

export function setLogger(_logger: Logger) {
    logger = _logger;
}
