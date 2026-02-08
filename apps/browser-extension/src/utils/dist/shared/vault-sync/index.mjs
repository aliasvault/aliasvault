// src/errors.ts
var VaultSyncErrorCodes = {
  IPFS_UPLOAD_FAILED: "VAULT_SYNC_IPFS_UPLOAD_FAILED",
  CONTRACT_UPDATE_FAILED: "VAULT_SYNC_CONTRACT_UPDATE_FAILED",
  CID_PERSISTENCE_FAILED: "VAULT_SYNC_CID_PERSISTENCE_FAILED",
  WALLET_NOT_CONNECTED: "VAULT_SYNC_WALLET_NOT_CONNECTED",
  INVALID_ENCRYPTED_DATA: "VAULT_SYNC_INVALID_ENCRYPTED_DATA"
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
var VaultSyncService = class {
  constructor(provider) {
    if (!provider) {
      throw new Error("VaultSyncProvider is required");
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
  async saveVault(encryptedVaultBytes) {
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
};
export {
  VaultSyncError,
  VaultSyncErrorCodes,
  VaultSyncService,
  base64ToUint8Array,
  bytesToHex,
  hexToUint8Array,
  sha256,
  uint8ArrayToBase64
};
