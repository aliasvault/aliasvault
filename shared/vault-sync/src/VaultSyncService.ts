import type { VaultSyncProvider, VaultSyncResult, VaultLoadProvider, VaultLoadResult } from './types.js';
import { VaultSyncError, VaultSyncErrorCodes } from './errors.js';
import { sha256, bytesToHex } from './utils.js';

/**
 * Orchestrates the vault save pipeline: IPFS upload → on-chain hash update → local CID persistence.
 * Platform-agnostic — browser extension, CLI, and mobile app each provide their own VaultSyncProvider.
 */
export class VaultSyncService {
  private readonly provider: VaultSyncProvider | null;

  constructor(provider?: VaultSyncProvider) {
    this.provider = provider ?? null;
  }

  /**
   * Load the latest vault from the blockchain + IPFS pipeline.
   *
   * Flow:
   * 1. Read vaultCidHash from on-chain public ledger
   * 2. Compare with locally cached cidHash
   * 3. If same → vault is up to date, return null
   * 4. If different → resolve CID (local cache or Pinata discovery) → download from IPFS
   * 5. Persist new CID + cidHash locally
   *
   * @returns VaultLoadResult with encrypted bytes, or null if vault is up to date
   * @throws VaultSyncError with VAULT_NOT_FOUND if no registration on-chain
   */
  async loadVault(loadProvider: VaultLoadProvider): Promise<VaultLoadResult | null> {
    // Step 1: Read on-chain cidHash
    let onChainCidHash: Uint8Array | null;
    try {
      onChainCidHash = await loadProvider.readContractCidHash();
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.LEDGER_READ_FAILED,
        'Failed to read vaultCidHash from on-chain ledger',
        true,
        error instanceof Error ? error : undefined,
      );
    }

    // Not registered on-chain → new user
    if (!onChainCidHash) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.VAULT_NOT_FOUND,
        'No vault registration found on-chain',
        false,
      );
    }

    const onChainCidHashHex = bytesToHex(onChainCidHash);

    // Step 2: Compare with local cidHash
    const local = await loadProvider.getLocalCid();

    if (local.cidHash && local.cidHash === onChainCidHashHex) {
      // Vault is up to date — no download needed
      return null;
    }

    // Step 3: Discover the new CID via Pinata pin listing.
    // IMPORTANT: When hashes differ, the local CID is stale (points to old vault).
    // Always discover the current CID by matching the on-chain hash against Pinata pins.
    let cid: string | null;
    try {
      cid = await loadProvider.discoverCidByHash(onChainCidHash);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_DISCOVERY_FAILED,
        'Failed to discover CID from Pinata pin listing',
        true,
        error instanceof Error ? error : undefined,
      );
    }

    if (!cid) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_DISCOVERY_FAILED,
        'No matching CID found in Pinata pins for on-chain hash',
        false,
      );
    }

    // Step 4: Download encrypted vault from IPFS
    let encryptedBytes: Uint8Array;
    try {
      encryptedBytes = await loadProvider.downloadFromIpfs(cid);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.IPFS_DOWNLOAD_FAILED,
        'Failed to download encrypted vault from IPFS',
        true,
        error instanceof Error ? error : undefined,
      );
    }

    // Step 5: Persist CID locally
    try {
      await loadProvider.persistCid(cid, onChainCidHashHex);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_PERSISTENCE_FAILED,
        'Failed to persist CID locally after download',
        true,
        error instanceof Error ? error : undefined,
      );
    }

    return {
      encryptedBytes,
      cid,
      cidHash: onChainCidHashHex,
      source: 'ipfs-download',
    };
  }

  /**
   * Save an encrypted vault blob through the full pipeline.
   *
   * Flow:
   * 1. Upload encrypted bytes to IPFS → CID
   * 2. SHA-256 hash the CID string → cidHash (Bytes<32> for on-chain)
   * 3. Update VaultRegistry contract with cidHash
   * 4. Persist CID + cidHash locally for quick access
   */
  async saveVault(encryptedVaultBytes: Uint8Array): Promise<VaultSyncResult> {
    if (!this.provider) {
      throw new Error('VaultSyncProvider is required for saveVault(). Pass a provider to the constructor.');
    }

    if (!encryptedVaultBytes || encryptedVaultBytes.length === 0) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.INVALID_ENCRYPTED_DATA,
        'Encrypted vault data must not be empty',
        false,
      );
    }

    // Step 1: Upload to IPFS → CID
    let cid: string;
    try {
      cid = await this.provider.uploadToIpfs(encryptedVaultBytes);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.IPFS_UPLOAD_FAILED,
        'Failed to upload encrypted vault to IPFS',
        true,
        error instanceof Error ? error : undefined,
      );
    }

    // Step 2: Hash CID for on-chain storage
    const cidHashBytes = await sha256(cid);
    const cidHashHex = bytesToHex(cidHashBytes);

    // Step 3: Update on-chain CID hash
    try {
      await this.provider.updateContractCidHash(cidHashBytes);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CONTRACT_UPDATE_FAILED,
        'Failed to update vault CID hash on-chain',
        false,
        error instanceof Error ? error : undefined,
      );
    }

    // Step 4: Persist CID locally
    try {
      await this.provider.persistCid(cid, cidHashHex);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_PERSISTENCE_FAILED,
        'Failed to persist CID locally',
        true,
        error instanceof Error ? error : undefined,
      );
    }

    return { cid, cidHash: cidHashHex };
  }
}
