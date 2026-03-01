import { assertCIDv1 } from '@aliasvault/contract';
import {
  validateSharePackage,
  decryptShareFromGuardian,
  base64ToUint8Array,
} from '@aliasvault/vault-sync';
import type { GuardianSharePackage, RecoveryShareFile } from '@aliasvault/vault-sync';

const DEFAULT_GATEWAY = 'https://gateway.pinata.cloud/ipfs';
const FETCH_TIMEOUT_MS = 30_000;

/** 72 hours in seconds */
const TIME_LOCK_SECONDS = 259_200;

/**
 * Fetch and validate a GuardianSharePackage from IPFS.
 */
export async function fetchSharePackage(
  cid: string,
  gatewayUrl: string = DEFAULT_GATEWAY,
): Promise<GuardianSharePackage> {
  assertCIDv1(cid);

  const url = `${gatewayUrl}/${cid}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch share package: HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  return validateSharePackage(data);
}

/**
 * Decrypt a guardian's share from the package using their RSA private key.
 * Returns a RecoveryShareFile JSON that can be exported to the vault owner.
 */
export async function decryptGuardianShare(
  sharePackage: GuardianSharePackage,
  shareIndex: number,
  rsaPrivateKey: JsonWebKey,
): Promise<RecoveryShareFile> {
  const share = sharePackage.shares.find((s) => s.index === shareIndex);
  if (!share) {
    throw new Error(`Share at index ${shareIndex} not found in package`);
  }

  const shareHex = await decryptShareFromGuardian(
    base64ToUint8Array(share.encryptedShare),
    rsaPrivateKey,
  );

  return { version: 1, shareIndex, shareHex };
}

/**
 * Find which share in the package belongs to this guardian by trying to
 * decrypt each share with the guardian's RSA private key.
 * RSA-OAEP decryption fails deterministically with the wrong key.
 */
export async function findGuardianShareIndex(
  sharePackage: GuardianSharePackage,
  rsaPrivateKey: JsonWebKey,
): Promise<number> {
  for (const share of sharePackage.shares) {
    try {
      await decryptShareFromGuardian(
        base64ToUint8Array(share.encryptedShare),
        rsaPrivateKey,
      );
      return share.index;
    } catch {
      continue; // Not this guardian's share
    }
  }
  throw new Error('No share found for this guardian key');
}

/**
 * Check whether a guardian can release their share based on contract state.
 */
export function canReleaseShare(
  recoveryInitiatedAt: bigint,
  approvalCount: number,
  threshold: number,
  recoveryComplete: boolean,
): { canRelease: boolean; reason?: string } {
  if (recoveryComplete) {
    return { canRelease: false, reason: 'Recovery already completed' };
  }

  if (recoveryInitiatedAt === 0n) {
    return { canRelease: false, reason: 'No active recovery' };
  }

  if (approvalCount < threshold) {
    return { canRelease: false, reason: `Insufficient approvals: ${approvalCount}/${threshold}` };
  }

  const unlockTime = Number(recoveryInitiatedAt) + TIME_LOCK_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  if (unlockTime >= now) {
    const remainingSeconds = unlockTime - now;
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    return {
      canRelease: false,
      reason: `Time-lock not expired: ${hours}h ${minutes}m remaining`,
    };
  }

  return { canRelease: true };
}
