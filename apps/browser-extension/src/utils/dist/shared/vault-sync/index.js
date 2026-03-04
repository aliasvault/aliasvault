"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  RecoveryClaimError: () => RecoveryClaimError,
  RecoveryClaimErrorCodes: () => RecoveryClaimErrorCodes,
  VaultSyncError: () => VaultSyncError,
  VaultSyncErrorCodes: () => VaultSyncErrorCodes,
  VaultSyncService: () => VaultSyncService,
  base64ToUint8Array: () => base64ToUint8Array,
  bytesToHex: () => bytesToHex,
  claimRecovery: () => claimRecovery,
  combineShares: () => combineShares,
  decryptShareFromGuardian: () => decryptShareFromGuardian,
  decryptWithRecoveryKey: () => decryptWithRecoveryKey,
  deriveEncryptionKey: () => deriveEncryptionKey,
  encryptShareForGuardian: () => encryptShareForGuardian,
  encryptWithRecoveryKey: () => encryptWithRecoveryKey,
  generateGuardianKeyPair: () => generateGuardianKeyPair,
  generateRecoveryKey: () => generateRecoveryKey,
  hexToUint8Array: () => hexToUint8Array,
  parseSharePackageFromBytes: () => parseSharePackageFromBytes,
  persistGuardianRecovery: () => persistGuardianRecovery,
  setupGuardianRecovery: () => setupGuardianRecovery,
  sha256: () => sha256,
  splitIntoShares: () => splitIntoShares,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  validateShareFile: () => validateShareFile,
  validateSharePackage: () => validateSharePackage
});
module.exports = __toCommonJS(index_exports);

// src/errors.ts
var VaultSyncErrorCodes = {
  IPFS_UPLOAD_FAILED: "VAULT_SYNC_IPFS_UPLOAD_FAILED",
  CONTRACT_UPDATE_FAILED: "VAULT_SYNC_CONTRACT_UPDATE_FAILED",
  CID_PERSISTENCE_FAILED: "VAULT_SYNC_CID_PERSISTENCE_FAILED",
  WALLET_NOT_CONNECTED: "VAULT_SYNC_WALLET_NOT_CONNECTED",
  INVALID_ENCRYPTED_DATA: "VAULT_SYNC_INVALID_ENCRYPTED_DATA",
  VAULT_NOT_FOUND: "VAULT_SYNC_VAULT_NOT_FOUND",
  CID_DISCOVERY_FAILED: "VAULT_SYNC_CID_DISCOVERY_FAILED",
  IPFS_DOWNLOAD_FAILED: "VAULT_SYNC_IPFS_DOWNLOAD_FAILED",
  LEDGER_READ_FAILED: "VAULT_SYNC_LEDGER_READ_FAILED",
  MERGE_DECRYPT_FAILED: "VAULT_SYNC_MERGE_DECRYPT_FAILED",
  MERGE_FAILED: "VAULT_SYNC_MERGE_FAILED",
  ENCRYPT_FAILED: "VAULT_SYNC_ENCRYPT_FAILED"
};
var VaultSyncError = class extends Error {
  constructor(code, message, retryable, cause) {
    super(message);
    this.name = "VaultSyncError";
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
  }
};

// src/utils.ts
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
async function sha256(data) {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return new Uint8Array(buffer);
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToUint8Array(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// src/VaultSyncService.ts
var import_vault_types = require("@aliasvault/vault-types");
var VaultSyncService = class {
  constructor(provider) {
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
  async loadVault(loadProvider) {
    let onChainCidHash;
    try {
      onChainCidHash = await loadProvider.readContractCidHash();
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.LEDGER_READ_FAILED,
        "Failed to read vaultCidHash from on-chain ledger",
        true,
        error instanceof Error ? error : void 0
      );
    }
    if (!onChainCidHash) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.VAULT_NOT_FOUND,
        "No vault registration found on-chain",
        false
      );
    }
    const onChainCidHashHex = bytesToHex(onChainCidHash);
    const local = await loadProvider.getLocalCid();
    if (local.cidHash && local.cidHash === onChainCidHashHex) {
      return null;
    }
    let cid;
    try {
      cid = await loadProvider.discoverCidByHash(onChainCidHash);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_DISCOVERY_FAILED,
        "Failed to discover CID from Pinata pin listing",
        true,
        error instanceof Error ? error : void 0
      );
    }
    if (!cid) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_DISCOVERY_FAILED,
        "No matching CID found in Pinata pins for on-chain hash",
        false
      );
    }
    let encryptedBytes;
    try {
      encryptedBytes = await loadProvider.downloadFromIpfs(cid);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.IPFS_DOWNLOAD_FAILED,
        "Failed to download encrypted vault from IPFS",
        true,
        error instanceof Error ? error : void 0
      );
    }
    try {
      await loadProvider.persistCid(cid, onChainCidHashHex);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_PERSISTENCE_FAILED,
        "Failed to persist CID locally after download",
        true,
        error instanceof Error ? error : void 0
      );
    }
    return {
      encryptedBytes,
      cid,
      cidHash: onChainCidHashHex,
      source: "ipfs-download"
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
  async saveVault(encryptedVaultBytes) {
    if (!this.provider) {
      throw new Error("VaultSyncProvider is required for saveVault(). Pass a provider to the constructor.");
    }
    if (!encryptedVaultBytes || encryptedVaultBytes.length === 0) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.INVALID_ENCRYPTED_DATA,
        "Encrypted vault data must not be empty",
        false
      );
    }
    let cid;
    try {
      cid = await this.provider.uploadToIpfs(encryptedVaultBytes);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.IPFS_UPLOAD_FAILED,
        "Failed to upload encrypted vault to IPFS",
        true,
        error instanceof Error ? error : void 0
      );
    }
    const cidHashBytes = await sha256(cid);
    const cidHashHex = bytesToHex(cidHashBytes);
    try {
      await this.provider.updateContractCidHash(cidHashBytes);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CONTRACT_UPDATE_FAILED,
        "Failed to update vault CID hash on-chain",
        false,
        error instanceof Error ? error : void 0
      );
    }
    try {
      await this.provider.persistCid(cid, cidHashHex);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_PERSISTENCE_FAILED,
        "Failed to persist CID locally",
        true,
        error instanceof Error ? error : void 0
      );
    }
    return { cid, cidHash: cidHashHex };
  }
  async encryptOrThrow(encrypt, plaintext, key) {
    try {
      return await encrypt(plaintext, key);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.ENCRYPT_FAILED,
        "Failed to encrypt vault data",
        false,
        error instanceof Error ? error : void 0
      );
    }
  }
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
  async saveWithConflictCheck(localVaultJson, encryptionKey, loadProvider, decrypt, encrypt) {
    if (!this.provider) {
      throw new Error("VaultSyncProvider is required for saveWithConflictCheck(). Pass a provider to the constructor.");
    }
    let onChainCidHash;
    try {
      onChainCidHash = await loadProvider.readContractCidHash();
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.LEDGER_READ_FAILED,
        "Failed to read vaultCidHash from on-chain ledger",
        true,
        error instanceof Error ? error : void 0
      );
    }
    const local = await loadProvider.getLocalCid();
    if (!local.cidHash || !onChainCidHash) {
      const encryptedBytes = await this.encryptOrThrow(encrypt, localVaultJson, encryptionKey);
      const result2 = await this.saveVault(encryptedBytes);
      return { ...result2, merged: false, uploadedBytes: encryptedBytes };
    }
    const onChainCidHashHex = bytesToHex(onChainCidHash);
    if (local.cidHash === onChainCidHashHex) {
      const encryptedBytes = await this.encryptOrThrow(encrypt, localVaultJson, encryptionKey);
      const result2 = await this.saveVault(encryptedBytes);
      return { ...result2, merged: false, uploadedBytes: encryptedBytes };
    }
    let remoteCid;
    try {
      remoteCid = await loadProvider.discoverCidByHash(onChainCidHash);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_DISCOVERY_FAILED,
        "Failed to discover CID from Pinata pin listing during conflict resolution",
        true,
        error instanceof Error ? error : void 0
      );
    }
    if (!remoteCid) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.CID_DISCOVERY_FAILED,
        "No matching CID found in Pinata pins for on-chain hash during conflict resolution",
        false
      );
    }
    let remoteEncryptedBytes;
    try {
      remoteEncryptedBytes = await loadProvider.downloadFromIpfs(remoteCid);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.IPFS_DOWNLOAD_FAILED,
        "Failed to download remote vault from IPFS during conflict resolution",
        true,
        error instanceof Error ? error : void 0
      );
    }
    let remoteVaultJson;
    try {
      remoteVaultJson = await decrypt(remoteEncryptedBytes, encryptionKey);
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.MERGE_DECRYPT_FAILED,
        "Failed to decrypt remote vault for merge \u2014 encryption key may have changed on another device",
        false,
        error instanceof Error ? error : void 0
      );
    }
    let mergedJson;
    let summary;
    try {
      const localVault = JSON.parse(localVaultJson);
      const remoteVault = JSON.parse(remoteVaultJson);
      const mergeResult = (0, import_vault_types.resolveVaultConflict)(localVault, remoteVault);
      mergedJson = JSON.stringify(mergeResult.merged);
      summary = mergeResult.summary;
    } catch (error) {
      throw new VaultSyncError(
        VaultSyncErrorCodes.MERGE_FAILED,
        "Failed to merge local and remote vaults",
        false,
        error instanceof Error ? error : void 0
      );
    }
    const mergedEncryptedBytes = await this.encryptOrThrow(encrypt, mergedJson, encryptionKey);
    const result = await this.saveVault(mergedEncryptedBytes);
    return {
      ...result,
      merged: true,
      summary,
      uploadedBytes: mergedEncryptedBytes
    };
  }
};

// src/recovery-crypto.ts
var secrets = __toESM(require("secrets.js-34r7h"));
async function deriveEncryptionKey(shamirSecret) {
  return sha256("aliasvault:rk:" + bytesToHex(shamirSecret));
}
async function generateRecoveryKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}
async function encryptWithRecoveryKey(plaintext, recoveryKey) {
  const key = await crypto.subtle.importKey("raw", recoveryKey, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return result;
}
async function decryptWithRecoveryKey(encrypted, recoveryKey) {
  const key = await crypto.subtle.importKey("raw", recoveryKey, "AES-GCM", false, ["decrypt"]);
  const iv = encrypted.slice(0, 12);
  const ciphertext = encrypted.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}
function splitIntoShares(dataHex, totalShares, threshold) {
  return secrets.share(dataHex, totalShares, threshold);
}
function combineShares(shares) {
  return secrets.combine(shares);
}
async function encryptShareForGuardian(shareHex, guardianPublicKeyJwk) {
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    guardianPublicKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const isOdd = shareHex.length % 2 !== 0;
  const paddedHex = isOdd ? "0" + shareHex : shareHex;
  const shareData = hexToUint8Array(paddedHex);
  const payload = new Uint8Array(1 + shareData.length);
  payload[0] = isOdd ? 1 : 0;
  payload.set(shareData, 1);
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, payload);
  return new Uint8Array(encrypted);
}
async function decryptShareFromGuardian(encryptedShare, guardianPrivateKeyJwk) {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    guardianPrivateKeyJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
  const decrypted = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encryptedShare);
  const decryptedArray = new Uint8Array(decrypted);
  const isOdd = decryptedArray[0] === 1;
  const hex = bytesToHex(decryptedArray.slice(1));
  return isOdd ? hex.slice(1) : hex;
}
async function generateGuardianKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["encrypt", "decrypt"]
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  return { publicKey, privateKey };
}

// src/recovery-setup.ts
async function setupGuardianRecovery(params) {
  const { masterPassword, guardianPublicKeys, ownerCommitment } = params;
  if (!masterPassword) {
    throw new Error("masterPassword is required");
  }
  if (!Array.isArray(guardianPublicKeys) || guardianPublicKeys.length !== 3) {
    throw new Error("Exactly 3 guardian public keys are required");
  }
  for (let i = 0; i < guardianPublicKeys.length; i++) {
    if (!guardianPublicKeys[i] || typeof guardianPublicKeys[i] !== "object") {
      throw new Error(`Guardian public key at index ${i} is invalid`);
    }
  }
  if (!ownerCommitment || typeof ownerCommitment !== "string") {
    throw new Error("ownerCommitment is required");
  }
  const shamirSecret = await generateRecoveryKey();
  const encryptionKey = await deriveEncryptionKey(shamirSecret);
  const encryptedPassword = await encryptWithRecoveryKey(masterPassword, encryptionKey);
  const shares = splitIntoShares(bytesToHex(shamirSecret), 3, 2);
  const encryptedShares = [];
  for (let i = 0; i < shares.length; i++) {
    const encrypted = await encryptShareForGuardian(shares[i], guardianPublicKeys[i]);
    encryptedShares.push({
      index: i,
      encryptedShare: uint8ArrayToBase64(encrypted)
    });
  }
  const recoveryKeyHash = await sha256(bytesToHex(shamirSecret));
  const sharePackage = {
    version: 2,
    vaultOwnerCommitment: ownerCommitment,
    threshold: 2,
    totalShares: 3,
    encryptedPassword: uint8ArrayToBase64(encryptedPassword),
    shares: encryptedShares
  };
  shamirSecret.fill(0);
  encryptionKey.fill(0);
  return { recoveryKeyHash, sharePackage };
}

// src/recovery-persist.ts
var import_contract = require("@aliasvault/contract");
async function persistGuardianRecovery(setupResult, provider) {
  const json = JSON.stringify(setupResult.sharePackage);
  const bytes = new TextEncoder().encode(json);
  const sharesCid = await provider.uploadToIpfs(bytes);
  (0, import_contract.assertCIDv1)(sharesCid);
  const sharesCidHash = await sha256(sharesCid);
  await provider.storeSharesCidHash(sharesCidHash);
  await provider.storeRecoveryKeyHash(setupResult.recoveryKeyHash);
  return { sharesCid };
}

// src/recovery-claim.ts
var RecoveryClaimError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "RecoveryClaimError";
  }
};
var RecoveryClaimErrorCodes = {
  INSUFFICIENT_SHARES: "RECOVERY_CLAIM_INSUFFICIENT_SHARES",
  HASH_MISMATCH: "RECOVERY_CLAIM_HASH_MISMATCH",
  DECRYPTION_FAILED: "RECOVERY_CLAIM_DECRYPTION_FAILED",
  INVALID_SHARE_PACKAGE: "RECOVERY_CLAIM_INVALID_SHARE_PACKAGE",
  INVALID_SHARE_FILE: "RECOVERY_CLAIM_INVALID_SHARE_FILE"
};
async function claimRecovery(params) {
  const { sharePackage, shareFiles, onChainRecoveryKeyHash } = params;
  if (shareFiles.length < sharePackage.threshold) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INSUFFICIENT_SHARES,
      `Need at least ${sharePackage.threshold} shares, got ${shareFiles.length}`
    );
  }
  const shamirSecretHex = combineShares(shareFiles.map((s) => s.shareHex));
  const computedHash = await sha256(shamirSecretHex);
  if (bytesToHex(computedHash) !== bytesToHex(onChainRecoveryKeyHash)) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.HASH_MISMATCH,
      "Reconstructed secret does not match on-chain recovery key hash"
    );
  }
  const encryptionKey = await deriveEncryptionKey(hexToUint8Array(shamirSecretHex));
  let masterPassword;
  try {
    const encryptedBytes = base64ToUint8Array(sharePackage.encryptedPassword);
    masterPassword = await decryptWithRecoveryKey(encryptedBytes, encryptionKey);
  } catch {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.DECRYPTION_FAILED,
      "Failed to decrypt master password with derived key"
    );
  }
  encryptionKey.fill(0);
  return { masterPassword };
}
function validateSharePackage(data) {
  if (!data || typeof data !== "object") {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package must be an object"
    );
  }
  const obj = data;
  if (obj.version !== 2) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      `Unsupported share package version: ${String(obj.version)}`
    );
  }
  if (typeof obj.encryptedPassword !== "string" || !obj.encryptedPassword) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package missing encryptedPassword"
    );
  }
  if (typeof obj.threshold !== "number" || obj.threshold < 1) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package missing or invalid threshold"
    );
  }
  if (typeof obj.totalShares !== "number" || obj.totalShares < 1) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package missing or invalid totalShares"
    );
  }
  if (typeof obj.vaultOwnerCommitment !== "string" || !obj.vaultOwnerCommitment) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package missing vaultOwnerCommitment"
    );
  }
  if (!Array.isArray(obj.shares) || obj.shares.length === 0) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package must have non-empty shares array"
    );
  }
  for (let i = 0; i < obj.shares.length; i++) {
    const share2 = obj.shares[i];
    if (typeof share2.index !== "number" || typeof share2.encryptedShare !== "string") {
      throw new RecoveryClaimError(
        RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
        `Invalid share at index ${i}`
      );
    }
  }
  return data;
}
function parseSharePackageFromBytes(bytes) {
  const json = new TextDecoder().decode(bytes);
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      "Share package is not valid JSON"
    );
  }
  return validateSharePackage(parsed);
}
function validateShareFile(data) {
  if (!data || typeof data !== "object") {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      "Share file must be an object"
    );
  }
  const obj = data;
  if (obj.version !== 1) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      `Unsupported share file version: ${String(obj.version)}`
    );
  }
  if (typeof obj.shareIndex !== "number") {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      "Share file missing shareIndex"
    );
  }
  if (typeof obj.shareHex !== "string" || !obj.shareHex) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      "Share file missing shareHex"
    );
  }
  return { version: 1, shareIndex: obj.shareIndex, shareHex: obj.shareHex };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RecoveryClaimError,
  RecoveryClaimErrorCodes,
  VaultSyncError,
  VaultSyncErrorCodes,
  VaultSyncService,
  base64ToUint8Array,
  bytesToHex,
  claimRecovery,
  combineShares,
  decryptShareFromGuardian,
  decryptWithRecoveryKey,
  deriveEncryptionKey,
  encryptShareForGuardian,
  encryptWithRecoveryKey,
  generateGuardianKeyPair,
  generateRecoveryKey,
  hexToUint8Array,
  parseSharePackageFromBytes,
  persistGuardianRecovery,
  setupGuardianRecovery,
  sha256,
  splitIntoShares,
  uint8ArrayToBase64,
  validateShareFile,
  validateSharePackage
});
