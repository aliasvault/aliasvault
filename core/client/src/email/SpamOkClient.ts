import type { MailboxEmail } from '@aliasvault/models/webapi';

/**
 * A SpamOK email as its API returns it.
 */
export type SpamOkEmail = {
  id: number;
  subject: string;
  fromDisplay: string;
  fromLocal: string;
  fromDomain: string;
  toLocal: string;
  toDomain: string;
  dateSystem: string;
  messageHtml: string | null;
  messagePlain: string | null;
  messageSource: string | null;
  attachments: { id: number; filename: string; mimeType: string; filesize: number }[];
};

/**
 * Client for the public SpamOK API, which serves the mailboxes of the public email domains.
 */
export class SpamOkClient {
  /**
   * Create a client that identifies itself as the given platform.
   * @param platformId - the platform id SpamOK expects, e.g. 'av-web'
   * @param platformVersion - the app version
   */
  public constructor(private readonly platformId: string, private readonly platformVersion: string) {}

  /**
   * Send a request to the SpamOK API.
   * @param method - the HTTP method
   * @param path - the path below the API root, e.g. `EmailBox/{prefix}`
   */
  public request(method: 'GET' | 'DELETE', path: string): Promise<Response> {
    return fetch(`https://api.spamok.com/v2/${path}`, { method, headers: { 'X-Asdasd-Platform-Id': this.platformId, 'X-Asdasd-Platform-Version': this.platformVersion } });
  }

  /**
   * The mails in a mailbox, or null when the request failed.
   * @param emailPrefix - the local part of the address
   */
  public async getMailbox(emailPrefix: string): Promise<MailboxEmail[] | null> {
    const response = await this.request('GET', `EmailBox/${emailPrefix}`);
    if (!response.ok) {
      return null;
    }
    const mailbox = await response.json() as { mails?: MailboxEmail[] };
    return mailbox.mails ?? [];
  }

  /**
   * One email, or null when the request failed.
   * @param emailPrefix - the local part of the address
   * @param emailId - the email id
   */
  public async getEmail(emailPrefix: string, emailId: number): Promise<SpamOkEmail | null> {
    const response = await this.request('GET', `Email/${emailPrefix}/${emailId}`);
    return response.ok ? await response.json() as SpamOkEmail : null;
  }

  /**
   * The bytes of an attachment, or null when the request failed.
   * @param emailId - the email id
   * @param attachmentId - the attachment id
   */
  public async getAttachment(emailId: number, attachmentId: number): Promise<Uint8Array | null> {
    const response = await this.request('GET', `Attachment/${emailId}/${attachmentId}/download`);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  }
}
