/**
 * Platform-agnostic vault sync provider interface.
 * Browser extension, CLI, and mobile app each implement this differently.
 */
export interface VaultSyncProvider {
  /** Upload encrypted vault bytes to IPFS, returns CIDv1 string. */
  uploadToIpfs(data: Uint8Array): Promise<string>;
  /** Update the on-chain CID hash in the VaultRegistry contract. */
  updateContractCidHash(cidHash: Uint8Array): Promise<void>;
  /** Persist CID and CID hash to local storage for quick access. */
  persistCid(cid: string, cidHash: string): Promise<void>;
}

/**
 * Configuration for VaultSyncService.
 */
export interface VaultSyncConfig {
  /** Maximum number of retries for transient failures (inherited from IpfsService). */
  maxRetries?: number;
}

/**
 * Result of a successful vault save operation.
 */
export interface VaultSyncResult {
  /** CIDv1 string of the uploaded encrypted vault blob. */
  cid: string;
  /** Hex-encoded SHA-256 hash of the CID string. */
  cidHash: string;
}
