export { VaultSyncService } from './VaultSyncService.js';
export { VaultSyncError, VaultSyncErrorCodes } from './errors.js';
export type { VaultSyncErrorCode } from './errors.js';
export { base64ToUint8Array, uint8ArrayToBase64, sha256, bytesToHex, hexToUint8Array } from './utils.js';
export type {
  VaultSyncProvider,
  VaultSyncResult,
  VaultLoadProvider,
  VaultLoadResult,
} from './types.js';
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
