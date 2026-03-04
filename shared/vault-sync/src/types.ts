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
 * Result of a successful vault save operation.
 */
export interface VaultSyncResult {
  /** CIDv1 string of the uploaded encrypted vault blob. */
  cid: string;
  /** Hex-encoded SHA-256 hash of the CID string. */
  cidHash: string;
}

/**
 * Platform-agnostic vault load provider interface.
 * Browser extension, CLI, and mobile app each implement this differently.
 */
export interface VaultLoadProvider {
  /** Read the vaultCidHash from the on-chain public ledger. Returns null if not registered. */
  readContractCidHash(): Promise<Uint8Array | null>;
  /** Get the locally cached CID string. Returns null if no local CID (new device). */
  getLocalCid(): Promise<{ cid: string | null; cidHash: string | null }>;
  /** Download encrypted vault bytes from IPFS by CID. */
  downloadFromIpfs(cid: string): Promise<Uint8Array>;
  /** Discover the CID by scanning Pinata pins and matching SHA-256 hash. Returns null if not found. */
  discoverCidByHash(cidHash: Uint8Array): Promise<string | null>;
  /** Persist CID and CID hash to local storage after successful download. */
  persistCid(cid: string, cidHash: string): Promise<void>;
}

/**
 * Result of saveWithConflictCheck(): indicates whether a merge occurred and the save result.
 */
export interface ConflictCheckResult {
  /** CIDv1 string of the uploaded vault blob. */
  cid: string;
  /** Hex-encoded SHA-256 hash of the CID string. */
  cidHash: string;
  /** True if a merge was performed (remote vault differed from local). */
  merged: boolean;
  /** Present only when merged === true. Summary of what changed during merge. */
  summary?: import('@aliasvault/vault-types').MergeSummary;
  /** The encrypted bytes that were actually uploaded (merged vault if conflict, original if no conflict). */
  uploadedBytes: Uint8Array;
}

/**
 * Result of a successful vault load operation.
 */
export interface VaultLoadResult {
  /** Raw encrypted vault bytes downloaded from IPFS. */
  encryptedBytes: Uint8Array;
  /** CIDv1 string of the vault blob. */
  cid: string;
  /** Hex-encoded SHA-256 hash of the CID string. */
  cidHash: string;
  /** How the vault was resolved. Always 'ipfs-download' since CID is always discovered fresh. */
  source: 'ipfs-download';
}
