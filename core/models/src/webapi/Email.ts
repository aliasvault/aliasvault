import { EmailAttachment } from "./EmailAttachment";

export type Email = {
    /** The body of the email message */
    messageHtml: string;

    /** The plain text body of the email message */
    messagePlain: string;

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

    /**
     * The encrypted symmetric key which was used to encrypt the email message.
     * This key is encrypted with the public key of the user.
     */
    encryptedSymmetricKey: string;

    /** The public key of the user used to encrypt the symmetric key */
    encryptionKey: string;

    /** The attachments of the email */
    attachments: EmailAttachment[];
}
