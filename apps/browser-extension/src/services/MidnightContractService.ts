/**
 * Midnight contract service for the browser extension.
 * Handles VaultRegistry contract interaction through Lace wallet providers.
 *
 * Provider setup derived from CLI's standalone.ts and Lace wallet v4+ API.
 * CRITICAL: Uses Lace wallet's proving provider for user-signed transactions.
 */

import { CONTRACTS } from '../../../../shared/config/contracts';
import { getNetworkConfig } from '../entrypoints/popup/config/networkConfig';

/**
 * Configuration for MidnightContractService.
 */
export interface MidnightContractConfig {
  /** VaultRegistry contract address. If empty, uses CONTRACTS.VaultRegistry.address. */
  contractAddress?: string;
  /** Indexer URL override. Defaults to getNetworkConfig().indexerUrl. */
  indexerUrl?: string;
  /** Proof server URL override. Defaults to getNetworkConfig().proofServerUrl. */
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
  private readonly indexerUrl: string;
  private readonly proofServerUrl: string;
  private contract: VaultRegistryContract | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cachedPublicDataProvider: any = null;

  constructor(config?: MidnightContractConfig) {
    this.contractAddress = config?.contractAddress || CONTRACTS.VaultRegistry.address;
    const defaults = getNetworkConfig();
    this.indexerUrl = config?.indexerUrl || defaults.indexerUrl;
    this.proofServerUrl = config?.proofServerUrl || defaults.proofServerUrl;

    if (!this.contractAddress) {
      throw new Error(
        'VaultRegistry contract address not configured. ' +
        'Set it in shared/config/contracts.ts or pass via config.contractAddress.'
      );
    }
  }

  /**
   * Join the deployed VaultRegistry contract.
   * Sets up providers (indexer for public data, proof server for ZK proofs)
   * and finds the deployed contract on-chain.
   *
   * @param secretKey - 32-byte secret key for witness private state (owner auth)
   */
  async joinVaultRegistry(secretKey: Uint8Array): Promise<void> {
    // Dynamic imports to enable tree-shaking and lazy-loading of Midnight SDK
    // This keeps the initial bundle small (NFR16: extension < 5MB)
    const { findDeployedContract } = await import('@midnight-ntwrk/midnight-js-contracts');
    const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
    const { httpClientProofProvider } = await import('@midnight-ntwrk/midnight-js-http-client-proof-provider');
    const { VaultRegistry, vaultRegistryWitnesses, createVaultRegistryPrivateState } = await import('@aliasvault/contract');
    const { CompiledContract } = await import('@midnight-ntwrk/compact-js');

    const compiledContract = CompiledContract.make('vault-registry', VaultRegistry.Contract).pipe(
      CompiledContract.withWitnesses(vaultRegistryWitnesses),
    );

    const providers = {
      proofProvider: httpClientProofProvider(this.proofServerUrl),
      publicDataProvider: indexerPublicDataProvider(this.indexerUrl),
    };

    this.contract = await findDeployedContract(providers, {
      contractAddress: this.contractAddress,
      compiledContract,
      privateStateId: 'vaultRegistryPrivateState',
      initialPrivateState: createVaultRegistryPrivateState(secretKey),
    });
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
    const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
    const { VaultRegistry } = await import('@aliasvault/contract');

    if (!this.cachedPublicDataProvider) {
      this.cachedPublicDataProvider = indexerPublicDataProvider(this.indexerUrl);
    }
    const contractState = await this.cachedPublicDataProvider.queryContractState(this.contractAddress);

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
    const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
    const { VaultRegistry } = await import('@aliasvault/contract');

    if (!this.cachedPublicDataProvider) {
      this.cachedPublicDataProvider = indexerPublicDataProvider(this.indexerUrl);
    }
    const contractState = await this.cachedPublicDataProvider.queryContractState(this.contractAddress);

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
    const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
    const { VaultRegistry } = await import('@aliasvault/contract');

    // L3: Cache the public data provider for reuse across calls
    if (!this.cachedPublicDataProvider) {
      this.cachedPublicDataProvider = indexerPublicDataProvider(this.indexerUrl);
    }
    const contractState = await this.cachedPublicDataProvider.queryContractState(this.contractAddress);

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
    const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
    const { VaultRegistry } = await import('@aliasvault/contract');

    if (!this.cachedPublicDataProvider) {
      this.cachedPublicDataProvider = indexerPublicDataProvider(this.indexerUrl);
    }
    const contractState = await this.cachedPublicDataProvider.queryContractState(this.contractAddress);

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
    const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
    const { VaultRegistry } = await import('@aliasvault/contract');

    if (!this.cachedPublicDataProvider) {
      this.cachedPublicDataProvider = indexerPublicDataProvider(this.indexerUrl);
    }
    const contractState = await this.cachedPublicDataProvider.queryContractState(this.contractAddress);

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
    if (!this.cachedPublicDataProvider) {
      const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
      this.cachedPublicDataProvider = indexerPublicDataProvider(this.indexerUrl);
    }
    return this.cachedPublicDataProvider;
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
