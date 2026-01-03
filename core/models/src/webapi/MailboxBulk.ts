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
    addresses: string[];
    currentPage: number;
    pageSize: number;
    totalRecords: number;
    mails: MailboxEmail[];
}