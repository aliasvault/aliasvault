export interface MoxNameAddress {
  Name: string;
  Address: string;
}

export interface MoxStructurePart {
  ContentType: string;
  ContentDisposition: string;
  Filename: string;
  DecodedSize: number;
  Parts: MoxStructurePart[];
}

export interface MoxMeta {
  MsgID: number;
  MailFrom: string;
  RcptTo: string;
  DKIMVerifiedDomains: string[];
  RemoteIP: string;
  Received: string;
  MailboxName: string;
  Automated: boolean;
}

export interface MoxWebhookPayload {
  Version: number;
  From: MoxNameAddress[];
  To: MoxNameAddress[];
  CC: MoxNameAddress[];
  Subject: string;
  MessageID: string;
  Date: string;
  Text: string;
  HTML: string;
  Structure: MoxStructurePart;
  Meta: MoxMeta;
}
