import * as _aliasvault_vault_types from '@aliasvault/vault-types';
export { MergeSummary } from '@aliasvault/vault-types';

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
 * Result of saveWithConflictCheck(): indicates whether a merge occurred and the save result.
 */
interface ConflictCheckResult {
    /** CIDv1 string of the uploaded vault blob. */
    cid: string;
    /** Hex-encoded SHA-256 hash of the CID string. */
    cidHash: string;
    /** True if a merge was performed (remote vault differed from local). */
    merged: boolean;
    /** Present only when merged === true. Summary of what changed during merge. */
    summary?: _aliasvault_vault_types.MergeSummary;
    /** The encrypted bytes that were actually uploaded (merged vault if conflict, original if no conflict). */
    uploadedBytes: Uint8Array;
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
    private encryptOrThrow;
    /**
     * Save vault with conflict detection: check on-chain hash vs local, merge if different.
     *
     * Flow:
     * 1. Read on-chain cidHash via loadProvider
     * 2. Compare with locally cached cidHash
     * 3. Same → save normally (no conflict)
     * 4. Different → download remote, decrypt, merge, re-encrypt, save merged
     *
     * Platform-agnostic: decrypt/encrypt callbacks are provided by the caller
     * (browser extension passes EncryptionUtility wrappers).
     *
     * @param localVaultJson - Decrypted local vault as JSON string
     * @param encryptionKey - Key for decrypting remote vault and re-encrypting merged vault
     * @param loadProvider - Platform-specific provider for reading on-chain hash, downloading from IPFS
     * @param decrypt - Callback to decrypt remote vault bytes → JSON string
     * @param encrypt - Callback to encrypt merged vault JSON string → Uint8Array
     */
    saveWithConflictCheck(localVaultJson: string, encryptionKey: string, loadProvider: VaultLoadProvider, decrypt: (encryptedBytes: Uint8Array, key: string) => Promise<string>, encrypt: (plaintext: string, key: string) => Promise<Uint8Array>): Promise<ConflictCheckResult>;
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
    readonly MERGE_DECRYPT_FAILED: "VAULT_SYNC_MERGE_DECRYPT_FAILED";
    readonly MERGE_FAILED: "VAULT_SYNC_MERGE_FAILED";
    readonly ENCRYPT_FAILED: "VAULT_SYNC_ENCRYPT_FAILED";
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

/**
 * Derive an encryption key from a Shamir secret using domain-separated SHA-256.
 * Key = SHA-256("aliasvault:rk:" + hex(shamirSecret))
 * Used in Pattern 6 v2 (ADR-007) to encrypt master password with ephemeral key.
 */
declare function deriveEncryptionKey(shamirSecret: Uint8Array): Promise<Uint8Array>;
/**
 * Generate a 32-byte recovery key using Web Crypto API.
 */
declare function generateRecoveryKey(): Promise<Uint8Array>;
/**
 * Encrypt plaintext with a recovery key using AES-256-GCM.
 * Output format: [iv(12) | ciphertext+authTag]
 * Web Crypto appends the 16-byte authTag to ciphertext automatically.
 */
declare function encryptWithRecoveryKey(plaintext: string, recoveryKey: Uint8Array): Promise<Uint8Array>;
/**
 * Decrypt data encrypted with encryptWithRecoveryKey.
 * Input format: [iv(12) | ciphertext+authTag]
 */
declare function decryptWithRecoveryKey(encrypted: Uint8Array, recoveryKey: Uint8Array): Promise<string>;
/**
 * Split a hex-encoded string into Shamir shares.
 * @param dataHex - Hex-encoded data to split
 * @param totalShares - Number of shares to generate
 * @param threshold - Minimum shares required to reconstruct
 */
declare function splitIntoShares(dataHex: string, totalShares: number, threshold: number): string[];
/**
 * Combine Shamir shares to reconstruct the original hex-encoded data.
 */
declare function combineShares(shares: string[]): string;
/**
 * Encrypt a hex-encoded share with a guardian's RSA public key (RSA-OAEP-SHA256).
 * Encodes share as binary (hex→bytes) to stay within RSA-OAEP 190-byte limit.
 * Prefixes 1 byte odd-length flag to handle Shamir shares with odd hex length.
 * Payload format: [1 byte: isOdd flag][binary share data]
 */
declare function encryptShareForGuardian(shareHex: string, guardianPublicKeyJwk: JsonWebKey): Promise<Uint8Array>;
/**
 * Decrypt an RSA-OAEP encrypted share using a guardian's private key.
 * Returns the hex-encoded share string.
 * Reverses the odd-length encoding from encryptShareForGuardian.
 */
declare function decryptShareFromGuardian(encryptedShare: Uint8Array, guardianPrivateKeyJwk: JsonWebKey): Promise<string>;
/**
 * Generate an RSA-OAEP 2048-bit key pair for guardian key setup and testing.
 */
declare function generateGuardianKeyPair(): Promise<{
    publicKey: JsonWebKey;
    privateKey: JsonWebKey;
}>;

interface RecoveryMetadata {
    version: 1;
    contractAddress: string;
    networkId: string;
    vaultOwnerCommitment: string;
    sharesCid?: string;
}
interface GuardianSharePackage {
    version: 2;
    vaultOwnerCommitment: string;
    threshold: number;
    totalShares: number;
    encryptedPassword: string;
    shares: Array<{
        index: number;
        encryptedShare: string;
    }>;
}
interface SetupGuardianRecoveryParams {
    masterPassword: string;
    guardianPublicKeys: [JsonWebKey, JsonWebKey, JsonWebKey];
    ownerCommitment: string;
}
interface SetupResult {
    recoveryKeyHash: Uint8Array;
    sharePackage: GuardianSharePackage;
}
/**
 * Orchestrate the full guardian recovery setup (v2 — ADR-007 Inverted Shamir):
 * 1. Generate ephemeral Shamir secret (32 random bytes — NEVER stored)
 * 2. Derive encryption key via domain-separated hash
 * 3. Encrypt master password with derived key (AES-256-GCM)
 * 4. Split the Shamir SECRET (not encrypted password) into 2-of-3 shares
 * 5. Encrypt each share with respective guardian's RSA public key
 * 6. Hash Shamir secret for on-chain verification
 * 7. Package encrypted password + encrypted shares into GuardianSharePackage v2
 * 8. Return { recoveryKeyHash, sharePackage } — shamirSecret + encryptionKey DISCARDED
 */
declare function setupGuardianRecovery(params: SetupGuardianRecoveryParams): Promise<SetupResult>;

interface RecoveryPersistProvider {
    uploadToIpfs(data: Uint8Array): Promise<string>;
    storeSharesCidHash(cidHash: Uint8Array): Promise<void>;
    storeRecoveryKeyHash(keyHash: Uint8Array): Promise<void>;
}
interface PersistResult {
    sharesCid: string;
}
/**
 * Persist guardian recovery data to IPFS and on-chain (v2 — ADR-007):
 * 1. Serialize share package to JSON → UTF-8 bytes
 * 2. Upload to IPFS
 * 3. Validate CID is CIDv1
 * 4. Hash CID for on-chain storage
 * 5. Store shares CID hash on-chain (GuardianRecovery)
 * 6. Store recovery key hash on-chain (VaultRegistry)
 */
declare function persistGuardianRecovery(setupResult: SetupResult, provider: RecoveryPersistProvider): Promise<PersistResult>;

interface RecoveryShareFile {
    version: 1;
    shareIndex: number;
    shareHex: string;
}
interface RecoveryClaimParams {
    sharePackage: GuardianSharePackage;
    shareFiles: RecoveryShareFile[];
    onChainRecoveryKeyHash: Uint8Array;
}
interface RecoveryClaimResult {
    masterPassword: string;
}
declare class RecoveryClaimError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
declare const RecoveryClaimErrorCodes: {
    readonly INSUFFICIENT_SHARES: "RECOVERY_CLAIM_INSUFFICIENT_SHARES";
    readonly HASH_MISMATCH: "RECOVERY_CLAIM_HASH_MISMATCH";
    readonly DECRYPTION_FAILED: "RECOVERY_CLAIM_DECRYPTION_FAILED";
    readonly INVALID_SHARE_PACKAGE: "RECOVERY_CLAIM_INVALID_SHARE_PACKAGE";
    readonly INVALID_SHARE_FILE: "RECOVERY_CLAIM_INVALID_SHARE_FILE";
};
/**
 * Claim recovery: combine Shamir shares, verify hash, decrypt master password.
 *
 * Steps:
 * 1. Validate share count >= threshold
 * 2. Combine shares → shamirSecretHex
 * 3. Verify SHA-256(shamirSecretHex) matches on-chain hash
 * 4. Derive encryption key from Shamir secret
 * 5. Decrypt encrypted password from share package
 * 6. Zero ephemeral key
 */
declare function claimRecovery(params: RecoveryClaimParams): Promise<RecoveryClaimResult>;
/**
 * Validate and parse a GuardianSharePackage from unknown data.
 */
declare function validateSharePackage(data: unknown): GuardianSharePackage;
/**
 * Parse a GuardianSharePackage from raw UTF-8 bytes (e.g., from IPFS).
 */
declare function parseSharePackageFromBytes(bytes: Uint8Array): GuardianSharePackage;
/**
 * Validate and parse a RecoveryShareFile from unknown data.
 */
declare function validateShareFile(data: unknown): RecoveryShareFile;

export { type ConflictCheckResult, type GuardianSharePackage, type PersistResult, RecoveryClaimError, RecoveryClaimErrorCodes, type RecoveryClaimParams, type RecoveryClaimResult, type RecoveryMetadata, type RecoveryPersistProvider, type RecoveryShareFile, type SetupGuardianRecoveryParams, type SetupResult, type VaultLoadProvider, type VaultLoadResult, VaultSyncError, type VaultSyncErrorCode, VaultSyncErrorCodes, type VaultSyncProvider, type VaultSyncResult, VaultSyncService, base64ToUint8Array, bytesToHex, claimRecovery, combineShares, decryptShareFromGuardian, decryptWithRecoveryKey, deriveEncryptionKey, encryptShareForGuardian, encryptWithRecoveryKey, generateGuardianKeyPair, generateRecoveryKey, hexToUint8Array, parseSharePackageFromBytes, persistGuardianRecovery, setupGuardianRecovery, sha256, splitIntoShares, uint8ArrayToBase64, validateShareFile, validateSharePackage };
