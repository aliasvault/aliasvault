import { deriveKek } from '../rust/RustCore';

import { EncryptionUtility } from './EncryptionUtility';

/**
 * The wrapped halves of an account key hierarchy: what the server stores, sent as-is in a register or
 * migration payload.
 */
export type AccountKeyBlobs = {
  encryptedAccountKey: string;
  encryptedVek: string;
  accountPublicKey: string;
  encryptedAccountPrivateKey: string;
};

/**
 * A newly created account key hierarchy: the wrapped blobs plus the plaintext halves the client keeps.
 */
export type AccountKeyHierarchy = {
  vaultEncryptionKey: string;
  accountPrivateKey: string;
  accountKeys: AccountKeyBlobs;
};

/**
 * Wrap the Account Key with the KEK derived from an unlock key.
 * @param accountKey - the Account Key (base64)
 * @param unlockKey - the unlock key (base64), the Argon2id output of the master password
 */
export async function wrapAccountKey(accountKey: string, unlockKey: string): Promise<string> {
  return EncryptionUtility.encryptVaultEncryptionKey(accountKey, await deriveKek(unlockKey));
}

/**
 * Unwrap the Account Key with the KEK derived from an unlock key; throws when the unlock key does not open it.
 * @param encryptedAccountKey - the wrapped Account Key
 * @param unlockKey - the unlock key (base64), the Argon2id output of the master password
 */
export async function unwrapAccountKey(encryptedAccountKey: string, unlockKey: string): Promise<string> {
  return EncryptionUtility.decryptVaultEncryptionKey(encryptedAccountKey, await deriveKek(unlockKey));
}

/**
 * Create a new account key hierarchy.
 * @param unlockKey - the unlock key (base64) whose derived KEK wraps this account's key material
 */
export async function createAccountKeyHierarchy(unlockKey: string): Promise<AccountKeyHierarchy> {
  const vaultEncryptionKey = EncryptionUtility.generateVaultEncryptionKey();
  const accountKey = EncryptionUtility.generateVaultEncryptionKey();
  const accountKeyPair = await EncryptionUtility.generateRsaKeyPair();

  return {
    vaultEncryptionKey,
    accountPrivateKey: accountKeyPair.privateKey,
    accountKeys: {
      encryptedAccountKey: await wrapAccountKey(accountKey, unlockKey),
      encryptedVek: await EncryptionUtility.encryptVaultEncryptionKey(vaultEncryptionKey, accountKey),
      accountPublicKey: accountKeyPair.publicKey,
      encryptedAccountPrivateKey: await EncryptionUtility.symmetricEncrypt(accountKeyPair.privateKey, accountKey),
    },
  };
}
