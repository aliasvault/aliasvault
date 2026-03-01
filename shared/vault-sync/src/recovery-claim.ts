import { combineShares, deriveEncryptionKey, decryptWithRecoveryKey } from './recovery-crypto.js';
import { sha256, bytesToHex, hexToUint8Array, base64ToUint8Array } from './utils.js';
import type { GuardianSharePackage } from './recovery-setup.js';

export interface RecoveryShareFile {
  version: 1;
  shareIndex: number;
  shareHex: string;
}

export interface RecoveryClaimParams {
  sharePackage: GuardianSharePackage;
  shareFiles: RecoveryShareFile[];
  onChainRecoveryKeyHash: Uint8Array;
}

export interface RecoveryClaimResult {
  masterPassword: string;
}

export class RecoveryClaimError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RecoveryClaimError';
  }
}

export const RecoveryClaimErrorCodes = {
  INSUFFICIENT_SHARES: 'RECOVERY_CLAIM_INSUFFICIENT_SHARES',
  HASH_MISMATCH: 'RECOVERY_CLAIM_HASH_MISMATCH',
  DECRYPTION_FAILED: 'RECOVERY_CLAIM_DECRYPTION_FAILED',
  INVALID_SHARE_PACKAGE: 'RECOVERY_CLAIM_INVALID_SHARE_PACKAGE',
  INVALID_SHARE_FILE: 'RECOVERY_CLAIM_INVALID_SHARE_FILE',
} as const;

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
export async function claimRecovery(params: RecoveryClaimParams): Promise<RecoveryClaimResult> {
  const { sharePackage, shareFiles, onChainRecoveryKeyHash } = params;

  // 1. Validate share count
  if (shareFiles.length < sharePackage.threshold) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INSUFFICIENT_SHARES,
      `Need at least ${sharePackage.threshold} shares, got ${shareFiles.length}`,
    );
  }

  // 2. Combine shares → shamirSecretHex
  const shamirSecretHex = combineShares(shareFiles.map((s) => s.shareHex));

  // 3. Verify on-chain hash
  const computedHash = await sha256(shamirSecretHex);
  if (bytesToHex(computedHash) !== bytesToHex(onChainRecoveryKeyHash)) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.HASH_MISMATCH,
      'Reconstructed secret does not match on-chain recovery key hash',
    );
  }

  // 4. Derive encryption key
  const encryptionKey = await deriveEncryptionKey(hexToUint8Array(shamirSecretHex));

  // 5. Decrypt master password
  let masterPassword: string;
  try {
    const encryptedBytes = base64ToUint8Array(sharePackage.encryptedPassword);
    masterPassword = await decryptWithRecoveryKey(encryptedBytes, encryptionKey);
  } catch {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.DECRYPTION_FAILED,
      'Failed to decrypt master password with derived key',
    );
  }

  // 6. Zero ephemeral key
  encryptionKey.fill(0);

  return { masterPassword };
}

/**
 * Validate and parse a GuardianSharePackage from unknown data.
 */
export function validateSharePackage(data: unknown): GuardianSharePackage {
  if (!data || typeof data !== 'object') {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      'Share package must be an object',
    );
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 2) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      `Unsupported share package version: ${String(obj.version)}`,
    );
  }

  if (typeof obj.encryptedPassword !== 'string' || !obj.encryptedPassword) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      'Share package missing encryptedPassword',
    );
  }

  if (typeof obj.threshold !== 'number' || obj.threshold < 1) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      'Share package missing or invalid threshold',
    );
  }

  if (typeof obj.totalShares !== 'number' || obj.totalShares < 1) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      'Share package missing or invalid totalShares',
    );
  }

  if (typeof obj.vaultOwnerCommitment !== 'string' || !obj.vaultOwnerCommitment) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      'Share package missing vaultOwnerCommitment',
    );
  }

  if (!Array.isArray(obj.shares) || obj.shares.length === 0) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      'Share package must have non-empty shares array',
    );
  }

  for (let i = 0; i < obj.shares.length; i++) {
    const share = obj.shares[i] as Record<string, unknown>;
    if (typeof share.index !== 'number' || typeof share.encryptedShare !== 'string') {
      throw new RecoveryClaimError(
        RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
        `Invalid share at index ${i}`,
      );
    }
  }

  return data as GuardianSharePackage;
}

/**
 * Parse a GuardianSharePackage from raw UTF-8 bytes (e.g., from IPFS).
 */
export function parseSharePackageFromBytes(bytes: Uint8Array): GuardianSharePackage {
  const json = new TextDecoder().decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_PACKAGE,
      'Share package is not valid JSON',
    );
  }
  return validateSharePackage(parsed);
}

/**
 * Validate and parse a RecoveryShareFile from unknown data.
 */
export function validateShareFile(data: unknown): RecoveryShareFile {
  if (!data || typeof data !== 'object') {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      'Share file must be an object',
    );
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      `Unsupported share file version: ${String(obj.version)}`,
    );
  }

  if (typeof obj.shareIndex !== 'number') {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      'Share file missing shareIndex',
    );
  }

  if (typeof obj.shareHex !== 'string' || !obj.shareHex) {
    throw new RecoveryClaimError(
      RecoveryClaimErrorCodes.INVALID_SHARE_FILE,
      'Share file missing shareHex',
    );
  }

  return { version: 1, shareIndex: obj.shareIndex, shareHex: obj.shareHex };
}
