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
 * Orchestrates the vault save pipeline: IPFS upload → on-chain hash update → local CID persistence.
 * Platform-agnostic — browser extension, CLI, and mobile app each provide their own VaultSyncProvider.
 */
declare class VaultSyncService {
    private readonly provider;
    constructor(provider: VaultSyncProvider);
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

export { VaultSyncError, type VaultSyncErrorCode, VaultSyncErrorCodes, type VaultSyncProvider, type VaultSyncResult, VaultSyncService, base64ToUint8Array, bytesToHex, hexToUint8Array, sha256, uint8ArrayToBase64 };
