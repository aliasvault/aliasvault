import { EmailDecryptionKey } from "./EmailDecryptionKey";

export type MailboxEmail = {
    /** The preview of the email message */
    messagePreview: string;

    /** Indicates whether the email has attachments */
    hasAttachments: boolean;

    /** The ID of the email */
    id: number;

    /** The subject of the email */
    subject: string;

    /** The display name of the sender */
    fromDisplay: string;

    /** The domain of the sender's email address */
    fromDomain: string;

    /** The local part of the sender's email address */
    fromLocal: string;

    /** The domain of the recipient's email address */
    toDomain: string;

    /** The local part of the recipient's email address */
    toLocal: string;

    /** The date of the email */
    date: string;

    /** The system date of the email */
    dateSystem: string;

    /** The number of seconds ago the email was received */
    secondsAgo: number;

    /** The encrypted copies of the email's symmetric key the caller can decrypt, one per manifest keypair the caller holds. */
    decryptionKeys: EmailDecryptionKey[];
}