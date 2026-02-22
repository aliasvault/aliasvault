import {
  generateRecoveryKey,
  encryptWithRecoveryKey,
  splitIntoShares,
  encryptShareForGuardian,
} from './recovery-crypto.js';
import { sha256, bytesToHex, uint8ArrayToBase64 } from './utils.js';

export interface GuardianSharePackage {
  version: 1;
  vaultOwnerCommitment: string;
  threshold: number;
  totalShares: number;
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
  recoveryKey: Uint8Array;
  recoveryKeyHash: Uint8Array; // SHA-256 hash for on-chain storage
  sharePackage: GuardianSharePackage;
}

/**
 * Orchestrate the full guardian recovery setup:
 * 1. Generate recovery key
 * 2. Hash recovery key for on-chain storage
 * 3. Encrypt master password with recovery key
 * 4. Split encrypted password into Shamir shares
 * 5. Encrypt each share with respective guardian's RSA public key
 * 6. Package into GuardianSharePackage
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

  // 1. Generate recovery key (32 bytes)
  const recoveryKey = await generateRecoveryKey();

  // 2. SHA-256 hash of hex-encoded recovery key for on-chain storage
  const recoveryKeyHash = await sha256(bytesToHex(recoveryKey));

  // 3. Encrypt master password with recovery key (AES-256-GCM)
  const encryptedPassword = await encryptWithRecoveryKey(masterPassword, recoveryKey);

  // 4. Convert encrypted password to hex for Shamir splitting
  const encryptedHex = bytesToHex(encryptedPassword);

  // 5. Split into 3 shares with threshold 2
  const shares = splitIntoShares(encryptedHex, 3, 2);

  // 6. Encrypt each share with respective guardian's RSA public key
  const encryptedShares: Array<{ index: number; encryptedShare: string }> = [];
  for (let i = 0; i < shares.length; i++) {
    const encrypted = await encryptShareForGuardian(shares[i], guardianPublicKeys[i]);
    encryptedShares.push({
      index: i,
      encryptedShare: uint8ArrayToBase64(encrypted),
    });
  }

  // 7. Package into GuardianSharePackage
  const sharePackage: GuardianSharePackage = {
    version: 1,
    vaultOwnerCommitment: ownerCommitment,
    threshold: 2,
    totalShares: 3,
    shares: encryptedShares,
  };

  return { recoveryKey, recoveryKeyHash, sharePackage };
}
