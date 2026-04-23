/**
 * Midnight contract service for the browser extension.
 * Handles VaultRegistry contract interaction through Lace wallet providers.
 *
 * Provider setup derived from CLI's standalone.ts and Lace wallet v4+ API.
 * CRITICAL: Uses Lace wallet's proving provider for user-signed transactions.
 *
 * NOTE: All Midnight SDK imports are STATIC (top-level), not dynamic.
 * Chrome MV3 service workers forbid dynamic import() per the HTML spec.
 * See: https://github.com/w3c/ServiceWorker/issues/1356
 * This file is statically imported by VaultMessageHandler → background.ts,
 * so these packages are bundled into the background chunk at build time.
 */

import { CONTRACTS } from '../../../../shared/config/contracts';
import { getWalletNetworkConfig } from '../entrypoints/popup/config/networkConfig';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { ExtensionZkConfigProvider } from './providers/ExtensionZkConfigProvider';
import { VaultRegistry, vaultRegistryWitnesses, createVaultRegistryPrivateState } from '@aliasvault/contract';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { InMemoryPrivateStateProvider } from './providers/InMemoryPrivateStateProvider';
import { LaceWalletProxy } from './providers/LaceWalletProxy';
import { LaceMidnightProxy } from './providers/LaceMidnightProxy';

/**
 * Configuration for MidnightContractService.
 * URL fields override wallet-provided / network-default URLs when set.
 */
export interface MidnightContractConfig {
  /** VaultRegistry contract address. If empty, uses CONTRACTS.VaultRegistry.address. */
  contractAddress?: string;
  /** Indexer HTTP URL override. Defaults to wallet config, then hardcoded network config. */
  indexerUrl?: string;
  /** Indexer WebSocket URL override. Defaults to wallet config, then hardcoded network config. */
  wsIndexerUrl?: string;
  /** Proof server URL override. Defaults to wallet config, then hardcoded network config. */
  proofServerUrl?: string;
}

/**
 * Manages VaultRegistry contract interactions from the browser extension.
 *
 * Architecture:
 * - Joins VaultRegistry via findDeployedContract using indexer + proof server providers
 * - Calls updateVault circuit with CID hash (Bytes<32>)
 * - Contract address loaded from shared/config/contracts.ts (ADR-004)
 *
 * NOTE: For MVP on local dev network, contract address may need to be set manually
 * after each deployment. Story 2.5 will automate this via deployment scripts.
 */
/**
 * Minimal typed interface for the joined VaultRegistry contract.
 * Avoids raw `any` while Midnight SDK types aren't installed in browser extension.
 * Matches the callTx shape from midnight-js-contracts findDeployedContract().
 */
interface VaultRegistryContract {
  callTx: {
    registerVault(walletAddressHash: Uint8Array): Promise<unknown>;
    updateVault(cidHash: Uint8Array): Promise<unknown>;
    setEmailPublicKey(pubKey: Uint8Array): Promise<unknown>;
    setMailRelay(relayCommit: Uint8Array): Promise<unknown>;
  };
  deployTxData: {
    public: {
      contractAddress: string;
    };
  };
}

export class MidnightContractService {
  private readonly contractAddress: string;
  private readonly indexerUrlOverride?: string;
  private readonly wsIndexerUrlOverride?: string;
  private readonly proofServerUrlOverride?: string;
  private contract: VaultRegistryContract | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cachedPublicDataProvider: any = null;

  constructor(config?: MidnightContractConfig) {
    this.contractAddress = config?.contractAddress || CONTRACTS.VaultRegistry.address;
    this.indexerUrlOverride = config?.indexerUrl;
    this.wsIndexerUrlOverride = config?.wsIndexerUrl;
    this.proofServerUrlOverride = config?.proofServerUrl;

    if (!this.contractAddress) {
      throw new Error(
        'VaultRegistry contract address not configured. ' +
        'Set it in shared/config/contracts.ts or pass via config.contractAddress.'
      );
    }
  }

  /**
   * Resolve network URLs: caller override → connected wallet → hardcoded fallback.
   * AC3: wallet's getConfiguration() is the primary source when connected.
   */
  private async resolveNetworkUrls(): Promise<{ indexerUrl: string; wsIndexerUrl: string; proofServerUrl: string }> {
    const walletConfig = await getWalletNetworkConfig();
    return {
      indexerUrl: this.indexerUrlOverride ?? walletConfig.indexerUrl,
      wsIndexerUrl: this.wsIndexerUrlOverride ?? walletConfig.wsIndexerUrl,
      proofServerUrl: this.proofServerUrlOverride ?? walletConfig.proofServerUrl,
    };
  }

  /**
   * Lazy-initialize the cached public data provider, resolving URLs via
   * the wallet config the first time it is called. Subsequent reads reuse
   * the cached provider.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async ensurePublicDataProvider(): Promise<any> {
    if (!this.cachedPublicDataProvider) {
      const { indexerUrl, wsIndexerUrl } = await this.resolveNetworkUrls();
      this.cachedPublicDataProvider = indexerPublicDataProvider(indexerUrl, wsIndexerUrl);
    }
    return this.cachedPublicDataProvider;
  }

  /**
   * Join the deployed VaultRegistry contract.
   * Sets up all 5 MidnightProviders:
   *   1. privateStateProvider  → InMemoryPrivateStateProvider (Map-based)
   *   2. publicDataProvider    → indexerPublicDataProvider (HTTP/WS)
   *   3. zkConfigProvider      → FetchZkConfigProvider (fetch-based, extension resources)
   *   4. proofProvider         → httpClientProofProvider (HTTP, requires zkConfigProvider)
   *   5. walletProvider        → LaceWalletProxy (chrome.scripting → page MAIN world)
   * Plus midnightProvider      → LaceMidnightProxy (chrome.scripting → page MAIN world)
   *
   * @param secretKey - 32-byte secret key for witness private state (owner auth)
   */
  async joinVaultRegistry(secretKey: Uint8Array): Promise<void> {
    // AC3: Resolve network URLs via wallet config (with override + fallback).
    // resolveNetworkUrls() is still called for proofServerUrl which the cached
    // provider doesn't own; the indexer URLs it returns must match the cached
    // provider's, which is guaranteed since both paths read the same wallet config.
    const { proofServerUrl } = await this.resolveNetworkUrls();

    const compiledContract = CompiledContract.make('vault-registry', VaultRegistry.Contract).pipe(
      CompiledContract.withWitnesses(vaultRegistryWitnesses),
    );

    // Provider 1: In-memory private state (Map-based, keyed by contractAddress:id)
    const privateStateProvider = new InMemoryPrivateStateProvider();

    // Provider 2: Public data from indexer (read-only, HTTP + WebSocket).
    // M3 (6.5b review): reuse the instance-cached provider instead of opening a
    // second indexer + WebSocket connection per join. ensurePublicDataProvider()
    // resolves network URLs once and caches on first use; later indexer reads
    // (isVaultRegistered, readEmailPublicKey, readMailRelay) share the same socket.
    const publicDataProvider = await this.ensurePublicDataProvider();

    // Provider 3: ZK config from bundled extension resources
    // Uses custom provider because FetchZkConfigProvider rejects chrome-extension:// URLs.
    // Fetches keys/{circuitId}.prover, keys/{circuitId}.verifier, zkir/{circuitId}.bzkir
    // from extension resources via chrome.runtime.getURL() + fetch().
    const zkConfigProvider = new ExtensionZkConfigProvider(fetch.bind(globalThis));

    // Provider 4: Proof generation via remote proof server
    // CRITICAL: httpClientProofProvider REQUIRES zkConfigProvider as second arg
    // (the `as any` cast previously hid this missing argument bug)
    //
    // TODO(6.5b M1): `proofServerUrl` originates from Lace's
    // `Configuration.proverServerUri`, which is @deprecated in dapp-connector-api@4.0.1.
    // The replacement is `connectedAPI.getProvingProvider(keyMaterialProvider)`, which
    // returns a `ProvingProvider: { check, prove }` object directly from the wallet
    // (the wallet may route to its own server, a WASM prover, or user preference).
    // Migration requires a proxy across the service-worker ↔ page boundary (same
    // pattern as LaceWalletProxy) since the returned object holds closures that
    // can't be serialized. For now we keep the httpClientProofProvider path and
    // emit warnings when proverServerUri is absent (see WalletMessageHandler.ts
    // and networkConfig.ts getWalletNetworkConfig).
    const proofProvider = httpClientProofProvider(proofServerUrl, zkConfigProvider);

    // Provider 5: Wallet operations proxied to Lace via chrome.scripting
    const walletProvider = new LaceWalletProxy();

    // MidnightProvider: Transaction submission proxied to Lace
    const midnightProvider = new LaceMidnightProxy();

    const providers = {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider,
      proofProvider,
      walletProvider,
      midnightProvider,
    };

    this.contract = await findDeployedContract(providers, {
      contractAddress: this.contractAddress,
      compiledContract,
      privateStateId: 'vaultRegistryPrivateState',
      initialPrivateState: createVaultRegistryPrivateState(secretKey),
    });
  }

  /**
   * Check if a vault is registered on-chain.
   * Reads the `owner` field from the public ledger — non-zero bytes means registered.
   * Uses indexer read (no ZK proof needed).
   *
   * Note: Cannot use readVaultCidHash() for this because it returns null for BOTH
   * "not registered" and "registered with zero CID hash" (initial state after registerVault).
   */
  async isVaultRegistered(): Promise<boolean> {
    const provider = await this.ensurePublicDataProvider();
    const contractState = await provider.queryContractState(this.contractAddress);
    if (!contractState) {
      return false;
    }
    const ledgerState = VaultRegistry.ledger(contractState.data);
    const owner = ledgerState.owner as Uint8Array;
    return !this.isZeroBytes(owner);
  }

  /**
   * Register a new vault on-chain.
   * Calls the registerVault circuit with the wallet address hash.
   * Must be called exactly once per wallet before updateVault.
   *
   * @param walletAddressHash - SHA-256 hash of wallet's shieldedAddress (32 bytes)
   */
  async registerVaultOnChain(walletAddressHash: Uint8Array): Promise<void> {
    if (!this.contract) {
      throw new Error('Contract not joined. Call joinVaultRegistry() first.');
    }
    // L1 (6.5b review): the current in-tree caller `ensureVaultRegistered` always passes
    // `await sha256(...)` which is 32 bytes — but this method is public API. Keep the
    // length check as defense-in-depth for direct/test callers (exercised by
    // MidnightContractService.test.ts:139-141) and for any future caller that doesn't
    // go through sha256. Cost is one property read; no hot-path impact.
    if (walletAddressHash.length !== 32) {
      throw new Error(`Wallet address hash must be exactly 32 bytes, got ${walletAddressHash.length}`);
    }
    await (this.contract as any).callTx.registerVault(walletAddressHash);
  }

  /**
   * Update the vault CID hash on-chain.
   * Requires prior call to joinVaultRegistry().
   *
   * @param cidHash - SHA-256 hash of CID string as Uint8Array (32 bytes)
   */
  async updateVaultOnChain(cidHash: Uint8Array): Promise<void> {
    if (!this.contract) {
      throw new Error('Contract not joined. Call joinVaultRegistry() first.');
    }

    if (cidHash.length !== 32) {
      throw new Error(`CID hash must be exactly 32 bytes, got ${cidHash.length}`);
    }

    await this.contract.callTx.updateVault(cidHash);
  }

  /**
   * Set the X25519 email public key on-chain.
   * Requires prior call to joinVaultRegistry().
   *
   * @param publicKey - X25519 public key as Uint8Array (32 bytes)
   */
  async setEmailPublicKey(publicKey: Uint8Array): Promise<void> {
    if (!this.contract) {
      throw new Error('Contract not joined. Call joinVaultRegistry() first.');
    }

    if (publicKey.length !== 32) {
      throw new Error(`Public key must be exactly 32 bytes, got ${publicKey.length}`);
    }

    await this.contract.callTx.setEmailPublicKey(publicKey);
  }

  /**
   * Authorize a mail relay on-chain.
   * Requires prior call to joinVaultRegistry().
   *
   * @param relayCommit - Relay commitment as Uint8Array (32 bytes)
   */
  async setMailRelay(relayCommit: Uint8Array): Promise<void> {
    if (!this.contract) {
      throw new Error('Contract not joined. Call joinVaultRegistry() first.');
    }

    if (relayCommit.length !== 32) {
      throw new Error(`Relay commitment must be exactly 32 bytes, got ${relayCommit.length}`);
    }

    await this.contract.callTx.setMailRelay(relayCommit);
  }

  /**
   * Read the emailPublicKey from the public ledger via the indexer.
   * Returns null if not set (zero bytes).
   */
  async readEmailPublicKey(): Promise<Uint8Array | null> {
    const provider = await this.ensurePublicDataProvider();
    const contractState = await provider.queryContractState(this.contractAddress);

    if (!contractState) {
      return null;
    }

    const ledgerState = VaultRegistry.ledger(contractState.data);
    const emailPubKey = ledgerState.emailPublicKey as Uint8Array;

    if (this.isZeroBytes(emailPubKey)) {
      return null;
    }

    return emailPubKey;
  }

  /**
   * Read the mailRelay commitment from the public ledger via the indexer.
   * Returns null if not set (zero bytes).
   */
  async readMailRelay(): Promise<Uint8Array | null> {
    const provider = await this.ensurePublicDataProvider();
    const contractState = await provider.queryContractState(this.contractAddress);

    if (!contractState) {
      return null;
    }

    const ledgerState = VaultRegistry.ledger(contractState.data);
    const mailRelay = ledgerState.mailRelay as Uint8Array;

    if (this.isZeroBytes(mailRelay)) {
      return null;
    }

    return mailRelay;
  }

  /**
   * Read the vaultCidHash from the public ledger via the indexer.
   * Returns null if the contract is not registered (owner is zero bytes or cidHash is zero bytes).
   *
   * Uses the indexer's public data provider to read contract state without a circuit call.
   */
  async readVaultCidHash(): Promise<Uint8Array | null> {
    // L3: Cache the public data provider for reuse across calls
    const provider = await this.ensurePublicDataProvider();
    const contractState = await provider.queryContractState(this.contractAddress);

    if (!contractState) {
      return null;
    }

    const ledgerState = VaultRegistry.ledger(contractState.data);
    const owner = ledgerState.owner as Uint8Array;
    const vaultCidHash = ledgerState.vaultCidHash as Uint8Array;

    // Check if unregistered: owner is zero bytes or cidHash is zero bytes
    if (this.isZeroBytes(owner) || this.isZeroBytes(vaultCidHash)) {
      return null;
    }

    return vaultCidHash;
  }

  /**
   * Read inboxManifestCid from the public ledger via the indexer.
   * Returns null if not set (empty string default on-chain).
   */
  async readInboxManifestCid(): Promise<string | null> {
    const provider = await this.ensurePublicDataProvider();
    const contractState = await provider.queryContractState(this.contractAddress);

    if (!contractState) {
      return null;
    }

    const ledgerState = VaultRegistry.ledger(contractState.data);
    const manifestCid = ledgerState.inboxManifestCid as string;

    if (!manifestCid || manifestCid.length === 0) {
      return null;
    }

    return manifestCid;
  }

  /**
   * Read emailCount from the public ledger via the indexer.
   * Returns 0 if contract state not found.
   */
  async readEmailCount(): Promise<number> {
    const provider = await this.ensurePublicDataProvider();
    const contractState = await provider.queryContractState(this.contractAddress);

    if (!contractState) {
      return 0;
    }

    const ledgerState = VaultRegistry.ledger(contractState.data);
    return (ledgerState.emailCount as number) ?? 0;
  }

  /**
   * Get the public data provider for observable subscriptions.
   * Lazily initializes the cached provider if not already created.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getPublicDataProvider(): Promise<any> {
    return this.ensurePublicDataProvider();
  }

  /**
   * Check if the contract has been joined.
   */
  isJoined(): boolean {
    return this.contract !== null;
  }

  /**
   * Get the configured contract address.
   */
  getContractAddress(): string {
    return this.contractAddress;
  }

  /**
   * Check if a byte array is all zeros (uninitialized ledger state).
   */
  private isZeroBytes(bytes: Uint8Array): boolean {
    return bytes.every((b) => b === 0);
  }
}
