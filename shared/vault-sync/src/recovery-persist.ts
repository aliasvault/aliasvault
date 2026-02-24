import { sha256 } from './utils.js';
import { assertCIDv1 } from '@aliasvault/contract';
import type { SetupResult, GuardianSharePackage } from './recovery-setup.js';

export interface RecoveryPersistProvider {
  uploadToIpfs(data: Uint8Array): Promise<string>; // Returns CIDv1
  storeSharesCidHash(cidHash: Uint8Array): Promise<void>; // GuardianRecovery contract
  storeRecoveryKeyHash(keyHash: Uint8Array): Promise<void>; // VaultRegistry contract
}

export interface PersistResult {
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
export async function persistGuardianRecovery(
  setupResult: SetupResult,
  provider: RecoveryPersistProvider,
): Promise<PersistResult> {
  // 1. Serialize share package to JSON → UTF-8 bytes
  const json = JSON.stringify(setupResult.sharePackage);
  const bytes = new TextEncoder().encode(json);

  // 2. Upload to IPFS
  const sharesCid = await provider.uploadToIpfs(bytes);

  // 3. Validate CIDv1
  assertCIDv1(sharesCid);

  // 4. Hash CID for on-chain storage
  const sharesCidHash = await sha256(sharesCid);

  // 5. Store shares CID hash on-chain (GuardianRecovery)
  await provider.storeSharesCidHash(sharesCidHash);

  // 6. Store recovery key hash on-chain (VaultRegistry)
  await provider.storeRecoveryKeyHash(setupResult.recoveryKeyHash);

  return { sharesCid };
}
