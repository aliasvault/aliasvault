/**
 * Platform-agnostic vault sync provider interface.
 * Browser extension, CLI, and mobile app each implement this differently.
 */
interface VaultSyncProvider {
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
interface VaultSyncResult {
    /** CIDv1 string of the uploaded encrypted vault blob. */
    cid: string;
    /** Hex-encoded SHA-256 hash of the CID string. */
    cidHash: string;
}
/**
 * Platform-agnostic vault load provider interface.
 * Browser extension, CLI, and mobile app each implement this differently.
 */
interface VaultLoadProvider {
    /** Read the vaultCidHash from the on-chain public ledger. Returns null if not registered. */
    readContractCidHash(): Promise<Uint8Array | null>;
    /** Get the locally cached CID string. Returns null if no local CID (new device). */
    getLocalCid(): Promise<{
        cid: string | null;
        cidHash: string | null;
    }>;
    /** Download encrypted vault bytes from IPFS by CID. */
    downloadFromIpfs(cid: string): Promise<Uint8Array>;
    /** Discover the CID by scanning Pinata pins and matching SHA-256 hash. Returns null if not found. */
    discoverCidByHash(cidHash: Uint8Array): Promise<string | null>;
    /** Persist CID and CID hash to local storage after successful download. */
    persistCid(cid: string, cidHash: string): Promise<void>;
}
/**
 * Result of a successful vault load operation.
 */
interface VaultLoadResult {
    /** Raw encrypted vault bytes downloaded from IPFS. */
    encryptedBytes: Uint8Array;
    /** CIDv1 string of the vault blob. */
    cid: string;
    /** Hex-encoded SHA-256 hash of the CID string. */
    cidHash: string;
    /** How the vault was resolved. Always 'ipfs-download' since CID is always discovered fresh. */
    source: 'ipfs-download';
}

/**
 * Orchestrates the vault save pipeline: IPFS upload → on-chain hash update → local CID persistence.
 * Platform-agnostic — browser extension, CLI, and mobile app each provide their own VaultSyncProvider.
 */
declare class VaultSyncService {
    private readonly provider;
    constructor(provider?: VaultSyncProvider);
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
    loadVault(loadProvider: VaultLoadProvider): Promise<VaultLoadResult | null>;
    /**
     * Save an encrypted vault blob through the full pipeline.
     *
     * Flow:
     * 1. Upload encrypted bytes to IPFS → CID
     * 2. SHA-256 hash the CID string → cidHash (Bytes<32> for on-chain)
     * 3. Update VaultRegistry contract with cidHash
     * 4. Persist CID + cidHash locally for quick access
     */
    saveVault(encryptedVaultBytes: Uint8Array): Promise<VaultSyncResult>;
}

/**
 * Vault sync error codes per architecture Pattern 4.
 */
declare const VaultSyncErrorCodes: {
    readonly IPFS_UPLOAD_FAILED: "VAULT_SYNC_IPFS_UPLOAD_FAILED";
    readonly CONTRACT_UPDATE_FAILED: "VAULT_SYNC_CONTRACT_UPDATE_FAILED";
    readonly CID_PERSISTENCE_FAILED: "VAULT_SYNC_CID_PERSISTENCE_FAILED";
    readonly WALLET_NOT_CONNECTED: "VAULT_SYNC_WALLET_NOT_CONNECTED";
    readonly INVALID_ENCRYPTED_DATA: "VAULT_SYNC_INVALID_ENCRYPTED_DATA";
    readonly VAULT_NOT_FOUND: "VAULT_SYNC_VAULT_NOT_FOUND";
    readonly CID_DISCOVERY_FAILED: "VAULT_SYNC_CID_DISCOVERY_FAILED";
    readonly IPFS_DOWNLOAD_FAILED: "VAULT_SYNC_IPFS_DOWNLOAD_FAILED";
    readonly LEDGER_READ_FAILED: "VAULT_SYNC_LEDGER_READ_FAILED";
};
type VaultSyncErrorCode = typeof VaultSyncErrorCodes[keyof typeof VaultSyncErrorCodes];
/**
 * Structured vault sync error with retry metadata.
 */
declare class VaultSyncError extends Error {
    readonly code: VaultSyncErrorCode;
    readonly retryable: boolean;
    readonly cause?: Error;
    constructor(code: VaultSyncErrorCode, message: string, retryable: boolean, cause?: Error);
}

/**
 * Convert a base64-encoded string to Uint8Array.
 * Used to convert EncryptionUtility.symmetricEncrypt() output for IPFS upload.
 */
declare function base64ToUint8Array(base64: string): Uint8Array;
/**
 * Convert Uint8Array to base64-encoded string.
 * Reverse of base64ToUint8Array — used in Story 2.4 (load flow).
 */
declare function uint8ArrayToBase64(bytes: Uint8Array): string;
/**
 * Compute SHA-256 hash of a string using Web Crypto API.
 * Returns raw bytes — use bytesToHex() for hex encoding.
 */
declare function sha256(data: string): Promise<Uint8Array>;
/**
 * Convert Uint8Array to hex-encoded string.
 */
declare function bytesToHex(bytes: Uint8Array): string;
/**
 * Convert hex string to Uint8Array.
 */
declare function hexToUint8Array(hex: string): Uint8Array;

export { type VaultLoadProvider, type VaultLoadResult, VaultSyncError, type VaultSyncErrorCode, VaultSyncErrorCodes, type VaultSyncProvider, type VaultSyncResult, VaultSyncService, base64ToUint8Array, bytesToHex, hexToUint8Array, sha256, uint8ArrayToBase64 };
