import type { VaultSyncProvider, VaultSyncResult } from './types.js';
import { VaultSyncError, VaultSyncErrorCodes } from './errors.js';
import { sha256, bytesToHex } from './utils.js';

/**
 * Orchestrates the vault save pipeline: IPFS upload → on-chain hash update → local CID persistence.
 * Platform-agnostic — browser extension, CLI, and mobile app each provide their own VaultSyncProvider.
 */
export class VaultSyncService {
  private readonly provider: VaultSyncProvider;

  constructor(provider: VaultSyncProvider) {
    if (!provider) {
      throw new Error('VaultSyncProvider is required');
    }
    this.provider = provider;
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
