import { EmailAttachment } from "./EmailAttachment";
import { EmailKeyWrap } from "./EmailKeyWrap";

export type Email = {
    /** The body of the email message. Null for source-only stored emails: derive it by parsing the source */
    messageHtml: string | null;

    /** The plain text body of the email message. Null for source-only stored emails: derive it by parsing the source */
    messagePlain: string | null;

    /**
     * The raw RFC 822 source of the email message (ciphertext, base64). For source-only stored emails the
     * decrypted plaintext is gzip-compressed and starts with the gzip magic bytes 0x1f 0x8b; parse the
     * (decompressed) source to derive the bodies and attachments.
     */
    messageSource: string;

    /** The number of attachments contained in the email message */
    attachmentCount: number;

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

    /** The wrapped copies of the email's symmetric key the caller can open, one per manifest keypair the caller holds */
    wraps: EmailKeyWrap[];

    /** The attachments of the email */
    attachments: EmailAttachment[];
}
