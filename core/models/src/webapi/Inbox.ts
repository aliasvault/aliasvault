import type { MailboxEmail } from "./MailboxEmail";

/**
 * One page of the inbox: the newest emails across all of the caller's active aliases.
 */
export type InboxResponse = {
    currentPage: number;
    pageSize: number;
    totalRecords: number;
    publicKeys: string[];
    mails: MailboxEmail[];
}
