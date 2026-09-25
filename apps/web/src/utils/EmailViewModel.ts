import EncryptionUtility from '@aliasvault/client/crypto/EncryptionUtility';
import { getEmailAttachmentBytes } from '@aliasvault/client/email/EmailAttachments';
import { SpamOkClient } from '@aliasvault/client/email/SpamOkClient';
import { decodeEmailSource } from '@aliasvault/client/rust/RustCore';

import type { WebApiService } from '@aliasvault/client/api/WebApiService';
import type { SqliteClient } from '@aliasvault/client/database/SqliteClient';
import type { Email } from '@aliasvault/models/webapi';

/**
 * An attachment of an email as shown in the email modal.
 */
export type EmailAttachmentViewModel = {
  filename: string;
  mimeType: string;
  size: number;
  index: number;
  partIndex: number | null;
  /** The attachment id on SpamOK, for SpamOK mail. */
  spamOkId: number | null;
};

/**
 * A decrypted, parsed email ready for display.
 */
export type EmailViewModel = {
  id: number;
  subject: string;
  fromDisplay: string;
  fromLocal: string;
  fromDomain: string;
  toLocal: string;
  toDomain: string;
  dateSystem: string;
  isSpamOk: boolean;
  htmlBody: string | null;
  textBody: string | null;
  sourceBytes: Uint8Array | null;
  sourceText: string | null;
  attachments: EmailAttachmentViewModel[];
  /** The email as the API returned it, for decrypting detached attachment bodies. */
  raw: Email | null;
};

/**
 * Whether the email has a source to show.
 */
export const hasSource = (email: EmailViewModel): boolean => email.sourceBytes !== null || (email.sourceText !== null && email.sourceText.trim().length > 0);

/** The web app's SpamOK API client. */
export const spamOk = new SpamOkClient('av-web', __APP_VERSION__);

/**
 * Load a SpamOK email.
 */
export async function loadSpamOkEmail(emailPrefix: string, emailId: number): Promise<EmailViewModel | null> {
  const email = await spamOk.getEmail(emailPrefix, emailId);
  if (!email) {
    return null;
  }
  return {
    id: email.id,
    subject: email.subject,
    fromDisplay: email.fromDisplay,
    fromLocal: email.fromLocal,
    fromDomain: email.fromDomain,
    toLocal: email.toLocal,
    toDomain: email.toDomain,
    dateSystem: email.dateSystem,
    isSpamOk: true,
    htmlBody: email.messageHtml,
    textBody: email.messagePlain,
    sourceBytes: null,
    sourceText: email.messageSource,
    attachments: email.attachments.map((a, index) => ({ filename: a.filename, mimeType: a.mimeType, size: a.filesize, index, partIndex: null, spamOkId: a.id })),
    raw: null,
  };
}

/**
 * Load and decrypt an AliasVault email.
 */
export async function loadAliasVaultEmail(webApi: WebApiService, sqliteClient: SqliteClient, emailId: number): Promise<EmailViewModel> {
  const email = await webApi.get<Email>(`Email/${emailId}`);
  const decrypted = await EncryptionUtility.decryptEmail(email, sqliteClient.encryptionKeys.getAll());
  return {
    id: decrypted.email.id,
    subject: decrypted.email.subject,
    fromDisplay: decrypted.email.fromDisplay,
    fromLocal: decrypted.email.fromLocal,
    fromDomain: decrypted.email.fromDomain,
    toLocal: decrypted.email.toLocal,
    toDomain: decrypted.email.toDomain,
    dateSystem: decrypted.email.dateSystem,
    isSpamOk: false,
    htmlBody: decrypted.htmlBody,
    textBody: decrypted.textBody,
    sourceBytes: decrypted.sourceBytes,
    sourceText: null,
    attachments: decrypted.attachments.map((a, index) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, index, partIndex: a.detached ? a.partIndex : null, spamOkId: null })),
    raw: email,
  };
}

/**
 * The raw source of an email as text, decoded on first use.
 */
export async function getSourceText(email: EmailViewModel): Promise<string> {
  if (email.sourceText !== null) {
    return email.sourceText;
  }
  if (email.sourceBytes === null) {
    return '';
  }
  try {
    email.sourceText = new TextDecoder().decode(await decodeEmailSource(email.sourceBytes));
  } catch (error) {
    console.warn(`Could not decode the source of email ${email.id}.`, error);
    return '';
  }
  return email.sourceText;
}

/**
 * The bytes of an attachment, fetched from SpamOK or extracted from the decrypted source.
 */
export async function getAttachmentBytes(webApi: WebApiService, sqliteClient: SqliteClient, email: EmailViewModel, attachment: EmailAttachmentViewModel): Promise<Uint8Array | null> {
  if (email.isSpamOk) {
    return attachment.spamOkId === null ? null : spamOk.getAttachment(email.id, attachment.spamOkId);
  }
  if (email.sourceBytes === null || email.raw === null) {
    return null;
  }
  return getEmailAttachmentBytes(webApi, email.raw, sqliteClient.encryptionKeys.getAll(), email.sourceBytes, attachment.index, attachment.partIndex);
}
