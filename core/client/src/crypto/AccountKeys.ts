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
 * Create a new account key hierarchy.
 * @param kek - the password-derived key this account's key material is wrapped with
 */
export async function createAccountKeyHierarchy(kek: string): Promise<AccountKeyHierarchy> {
  const vaultEncryptionKey = EncryptionUtility.generateVaultEncryptionKey();
  const accountKey = EncryptionUtility.generateVaultEncryptionKey();
  const accountKeyPair = await EncryptionUtility.generateRsaKeyPair();

  return {
    vaultEncryptionKey,
    accountPrivateKey: accountKeyPair.privateKey,
    accountKeys: {
      encryptedAccountKey: await EncryptionUtility.encryptVaultEncryptionKey(accountKey, kek),
      encryptedVek: await EncryptionUtility.encryptVaultEncryptionKey(vaultEncryptionKey, accountKey),
      accountPublicKey: accountKeyPair.publicKey,
      encryptedAccountPrivateKey: await EncryptionUtility.symmetricEncrypt(accountKeyPair.privateKey, accountKey),
    },
  };
}
