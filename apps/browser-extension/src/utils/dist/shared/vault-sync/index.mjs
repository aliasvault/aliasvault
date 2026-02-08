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
  LEDGER_READ_FAILED: "VAULT_SYNC_LEDGER_READ_FAILED"
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
