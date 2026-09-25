import EncryptionUtility from '../crypto/EncryptionUtility';
import { extractEmailAttachment } from '../rust/RustCore';

import type { WebApiService } from '../api/WebApiService';
import type { EncryptionKey } from '@aliasvault/models/vault';
import type { Email } from '@aliasvault/models/webapi';

/**
 * The bytes of an attachment of a decrypted AliasVault email.
 * @param webApi - the WebAPI service, to fetch a detached body
 * @param email - the email as the API returned it
 * @param encryptionKeys - the vault's encryption keys, to decrypt a detached body
 * @param sourceBytes - the decrypted source of the email
 * @param index - the attachment's index in the parsed source
 * @param partIndex - the index of the detached part on the server, or null when the body is in the source
 * @returns The attachment bytes
 */
export async function getEmailAttachmentBytes(webApi: Pick<WebApiService, 'downloadBlob'>, email: Email, encryptionKeys: EncryptionKey[], sourceBytes: Uint8Array, index: number, partIndex: number | null): Promise<Uint8Array> {
  let detachedBody: Uint8Array | undefined;
  if (partIndex !== null) {
    const encryptedPart = await webApi.downloadBlob(`Email/${email.id}/parts/${partIndex}`);
    detachedBody = await EncryptionUtility.decryptAttachment(encryptedPart, email, encryptionKeys);
  }
  return extractEmailAttachment(sourceBytes, index, detachedBody);
}
