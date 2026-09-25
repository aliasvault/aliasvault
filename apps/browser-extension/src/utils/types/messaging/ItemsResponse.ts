import type { ItemRef } from "@aliasvault/client/database/ItemRef";
import type { Item } from "@aliasvault/models/vault";

export type ItemsResponse = {
    success: boolean,
    error?: string,
    items?: Item[],
    recentlySelected?: ItemRef | null
};
