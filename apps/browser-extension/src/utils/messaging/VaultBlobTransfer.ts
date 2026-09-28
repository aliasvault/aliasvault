import { sendMessage, type VaultBlobStoreOptions } from '@/utils/messaging/ExtensionMessaging';

/**
 * Characters of the encrypted vault blob per STORE_ENCRYPTED_VAULT message. A single runtime message is capped at
 * 64 MiB in Chrome, which a large vault could exceed, so communication happens in chunks by default.
 */
const VAULT_BLOB_CHUNK_CHARS = 8 * 1024 * 1024;

/**
 * Send an encrypted vault blob to the background in chunks and store it there. The last chunk carries the store options.
 * @param vaultBlob - the encrypted vault blob
 * @param options - how the background stores the blob
 * @returns The store result the background reported for the last chunk
 */
export async function storeEncryptedVault(vaultBlob: string, options: VaultBlobStoreOptions): Promise<{ success: boolean; mutationSequence: number }> {
  const transferId = crypto.randomUUID();
  const chunkCount = Math.max(1, Math.ceil(vaultBlob.length / VAULT_BLOB_CHUNK_CHARS));
  for (let index = 0; index < chunkCount - 1; index++) {
    await sendMessage('STORE_ENCRYPTED_VAULT', { transferId, index, chunk: vaultBlob.slice(index * VAULT_BLOB_CHUNK_CHARS, (index + 1) * VAULT_BLOB_CHUNK_CHARS) });
  }

  const lastIndex = chunkCount - 1;
  // A chunk that carries the store options always gets the store result back, never null.
  return (await sendMessage('STORE_ENCRYPTED_VAULT', { transferId, index: lastIndex, chunk: vaultBlob.slice(lastIndex * VAULT_BLOB_CHUNK_CHARS), commit: options }))!;
}
