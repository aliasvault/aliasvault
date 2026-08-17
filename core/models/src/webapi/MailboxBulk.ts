import { MailboxEmail } from "./MailboxEmail";

/**
 * Mailbox bulk request type.
 */
export type MailboxBulkRequest = {
    addresses: string[];
    page: number;
    pageSize: number;
}

/**
 * Mailbox bulk response type.
 */
export type MailboxBulkResponse = {
    currentPage: number;
    pageSize: number;
    totalRecords: number;
    publicKeys: string[];
    mails: MailboxEmail[];
}