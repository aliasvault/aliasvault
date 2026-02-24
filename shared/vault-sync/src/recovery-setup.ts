import {
  generateRecoveryKey,
  deriveEncryptionKey,
  encryptWithRecoveryKey,
  splitIntoShares,
  encryptShareForGuardian,
} from './recovery-crypto.js';
import { sha256, bytesToHex, uint8ArrayToBase64 } from './utils.js';

export interface RecoveryMetadata {
  version: 1;
  contractAddress: string;
  networkId: string;
  vaultOwnerCommitment: string;
}

export interface GuardianSharePackage {
  version: 2;
  vaultOwnerCommitment: string;
  threshold: number;
  totalShares: number;
  encryptedPassword: string; // base64 of AES-256-GCM encrypted master password
  shares: Array<{
    index: number;
    encryptedShare: string; // base64 of RSA-encrypted share
  }>;
}

export interface SetupGuardianRecoveryParams {
  masterPassword: string;
  guardianPublicKeys: [JsonWebKey, JsonWebKey, JsonWebKey];
  ownerCommitment: string; // hex
}

export interface SetupResult {
  recoveryKeyHash: Uint8Array; // SHA-256 hash of shamirSecret hex for on-chain verification
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
export async function setupGuardianRecovery(
  params: SetupGuardianRecoveryParams,
): Promise<SetupResult> {
  const { masterPassword, guardianPublicKeys, ownerCommitment } = params;

  // Input validation at system boundary
  if (!masterPassword) {
    throw new Error('masterPassword is required');
  }
  if (!Array.isArray(guardianPublicKeys) || guardianPublicKeys.length !== 3) {
    throw new Error('Exactly 3 guardian public keys are required');
  }
  for (let i = 0; i < guardianPublicKeys.length; i++) {
    if (!guardianPublicKeys[i] || typeof guardianPublicKeys[i] !== 'object') {
      throw new Error(`Guardian public key at index ${i} is invalid`);
    }
  }
  if (!ownerCommitment || typeof ownerCommitment !== 'string') {
    throw new Error('ownerCommitment is required');
  }

  // 1. Generate ephemeral Shamir secret (32 random bytes)
  const shamirSecret = await generateRecoveryKey();

  // 2. Derive encryption key via domain-separated SHA-256
  const encryptionKey = await deriveEncryptionKey(shamirSecret);

  // 3. Encrypt master password with derived key (AES-256-GCM)
  const encryptedPassword = await encryptWithRecoveryKey(masterPassword, encryptionKey);

  // 4. Split the Shamir SECRET (hex-encoded) into 2-of-3 shares
  const shares = splitIntoShares(bytesToHex(shamirSecret), 3, 2);

  // 5. Encrypt each share with respective guardian's RSA public key
  const encryptedShares: Array<{ index: number; encryptedShare: string }> = [];
  for (let i = 0; i < shares.length; i++) {
    const encrypted = await encryptShareForGuardian(shares[i], guardianPublicKeys[i]);
    encryptedShares.push({
      index: i,
      encryptedShare: uint8ArrayToBase64(encrypted),
    });
  }

  // 6. SHA-256 hash of shamirSecret hex for on-chain verification
  const recoveryKeyHash = await sha256(bytesToHex(shamirSecret));

  // 7. Package into GuardianSharePackage v2
  const sharePackage: GuardianSharePackage = {
    version: 2,
    vaultOwnerCommitment: ownerCommitment,
    threshold: 2,
    totalShares: 3,
    encryptedPassword: uint8ArrayToBase64(encryptedPassword),
    shares: encryptedShares,
  };

  // Zero ephemeral secrets before discard
  shamirSecret.fill(0);
  encryptionKey.fill(0);

  return { recoveryKeyHash, sharePackage };
}
