import type { Item } from "@/utils/dist/core/models/vault";

export type ItemsResponse = {
    success: boolean,
    error?: string,
    items?: Item[]
};
