import type { MailboxEmail } from "./MailboxEmail";

/**
 * Mailbox bulk request type. The server resolves the addresses from the caller's active alias claims.
 */
export type MailboxBulkRequest = {
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