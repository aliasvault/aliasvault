import type { MailboxEmail } from "./MailboxEmail";

/**
 * Mailbox response type for a single address.
 */
export type Mailbox = {
    address: string;
    subscribed: boolean;
    publicKeys: string[];
    mails: MailboxEmail[];

    /** The manifest that owns the alias. */
    ownerManifestId: string | null;

    /** Whether the caller may move the alias to another manifest it can access. */
    canTransfer: boolean;

    /** The version of the alias claim, which a move to another manifest is signed over. */
    claimVersion: number | null;
}
