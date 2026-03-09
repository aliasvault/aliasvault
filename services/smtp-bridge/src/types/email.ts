export interface EmailAttachment {
  name: string;
  contentType: string;
  base64: string;
}

export interface IncomingEmail {
  to: string;
  from: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
}

export interface EmailPayload {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
  receivedAt: number;
}

export interface InboxManifest {
  version: 1;
  emails: InboxManifestEntry[];
}

export interface InboxManifestEntry {
  cid: string;
  ts: number;
}
