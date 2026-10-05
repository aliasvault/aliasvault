import type { ItemRef } from "@aliasvault/client/database/ItemRef";

/**
 * What the in-page autofill popup may know about an item before the user picks it: no passwords, no TOTP secrets.
 */
export type AutofillItemSummary = ItemRef & {
    Name: string,
    Logo?: Uint8Array | number[],
    Details: string
};

export type ItemsResponse = {
    success: boolean,
    error?: string,
    items?: AutofillItemSummary[],
    recentlySelected?: ItemRef | null
};
