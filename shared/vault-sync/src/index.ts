export { VaultSyncService } from './VaultSyncService.js';
export { VaultSyncError, VaultSyncErrorCodes } from './errors.js';
export type { VaultSyncErrorCode } from './errors.js';
export { base64ToUint8Array, uint8ArrayToBase64, sha256, bytesToHex, hexToUint8Array } from './utils.js';
export type {
  VaultSyncProvider,
  VaultSyncResult,
  VaultLoadProvider,
  VaultLoadResult,
  ConflictCheckResult,
} from './types.js';
export type { MergeSummary } from '@aliasvault/vault-types';
export {
  deriveEncryptionKey,
  generateRecoveryKey,
  encryptWithRecoveryKey,
  decryptWithRecoveryKey,
  splitIntoShares,
  combineShares,
  encryptShareForGuardian,
  decryptShareFromGuardian,
  generateGuardianKeyPair,
} from './recovery-crypto.js';
export { setupGuardianRecovery } from './recovery-setup.js';
export type { RecoveryMetadata, GuardianSharePackage, SetupGuardianRecoveryParams, SetupResult } from './recovery-setup.js';
export { persistGuardianRecovery } from './recovery-persist.js';
export type { RecoveryPersistProvider, PersistResult } from './recovery-persist.js';
export {
  claimRecovery,
  validateSharePackage,
  parseSharePackageFromBytes,
  validateShareFile,
  RecoveryClaimError,
  RecoveryClaimErrorCodes,
} from './recovery-claim.js';
export type { RecoveryShareFile, RecoveryClaimParams, RecoveryClaimResult } from './recovery-claim.js';
