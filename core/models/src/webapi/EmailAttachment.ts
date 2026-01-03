/**
 * Email attachment type.
 */
export type EmailAttachment = {
    /** The ID of the attachment */
    id: number;

    /** The ID of the email the attachment belongs to */
    emailId: number;

    /** The filename of the attachment */
    filename: string;

    /** The MIME type of the attachment */
    mimeType: string;

    /** The size of the attachment in bytes */
    filesize: number;
}