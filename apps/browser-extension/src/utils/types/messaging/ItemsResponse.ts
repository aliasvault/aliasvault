import type { Item } from "@aliasvault/models/vault";

export type ItemsResponse = {
    success: boolean,
    error?: string,
    items?: Item[],
    recentlySelectedId?: string | null
};
