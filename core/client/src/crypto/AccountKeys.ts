import { createAccountKeyHierarchy as createHierarchy } from '../rust/RustCore';

import { EncryptionUtility } from './EncryptionUtility';

import type { AccountKeyHierarchy } from '../rust/RustCoreTypes';

export type { AccountKeyBlobs, AccountKeyHierarchy } from '../rust/RustCoreTypes';

/**
 * Create a new account key hierarchy. The keypair comes from WebCrypto, which is far faster than RSA in wasm.
 * @param unlockKey - the unlock key (base64) whose derived KEK encrypts this account's key material
 */
export async function createAccountKeyHierarchy(unlockKey: string): Promise<AccountKeyHierarchy> {
  const accountKeyPair = await EncryptionUtility.generateRsaKeyPair();
  return createHierarchy(unlockKey, accountKeyPair.publicKey, accountKeyPair.privateKey);
}
