import { rebuildEmailSource, type ParsedEmailAttachment } from '../rust/RustCore';

import { decryptEmailAttachment } from './EmailDecryption';

import type { WebApiService } from '../api/WebApiService';
import type { EncryptionKey } from '@aliasvault/models/vault';
import type { Email } from '@aliasvault/models/webapi';

/** The content type of an .eml file. */
export const EML_MIME_TYPE = 'message/rfc822';

/** Max amount of characters to use in filename (from subject). */
const MAX_FILENAME_CHARACTERS = 60;

/**
 * The full .eml bytes of a decrypted AliasVault email, with the bodies of its detached attachments fetched and put back.
 * @param webApi - the WebAPI service, to fetch the detached bodies
 * @param email - the email as the API returned it
 * @param encryptionKeys - the vault's encryption keys, to decrypt the detached bodies
 * @param sourceBytes - the decrypted source of the email
 * @param attachments - the attachments of the email, with the part index of each detached one
 * @returns The .eml bytes
 */
export async function getEmailEmlBytes(webApi: Pick<WebApiService, 'downloadBlob'>, email: Email, encryptionKeys: EncryptionKey[], sourceBytes: Uint8Array, attachments: ReadonlyArray<Pick<ParsedEmailAttachment, 'partIndex'>>): Promise<Uint8Array> {
  const partIndexes = attachments.flatMap(attachment => attachment.partIndex !== null ? [attachment.partIndex] : []);
  const partCount = partIndexes.length > 0 ? Math.max(...partIndexes) + 1 : 0;
  const detachedBodies = await Promise.all(Array.from({ length: partCount }, async (_, partIndex) => {
    const encryptedPart = await webApi.downloadBlob(`Email/${email.id}/parts/${partIndex}`);
    return decryptEmailAttachment(encryptedPart, email, encryptionKeys);
  }));
  return rebuildEmailSource(sourceBytes, detachedBodies);
}

/**
 * The file name to save an email as: its subject without characters a file system rejects, or `email` without one.
 */
export function getEmlFileName(subject: string): string {
  const cleaned = Array.from(subject, character => isFileNameCharacter(character) ? character : ' ').join('').replace(/\s+/g, ' ').trim();
  const name = Array.from(cleaned).slice(0, MAX_FILENAME_CHARACTERS).join('').trim().replace(/^\.+/, '');
  return `${name.length > 0 ? name : 'email'}.eml`;
}

/**
 * Whether a character is allowed in a file name on every platform the apps run on.
 */
function isFileNameCharacter(character: string): boolean {
  const code = character.charCodeAt(0);
  return code > 31 && code !== 127 && !'<>:"/\\|?*'.includes(character);
}
