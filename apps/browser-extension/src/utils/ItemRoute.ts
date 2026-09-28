import type { ItemRef } from '@aliasvault/client/database/ItemRef';

/**
 * The popup route of an item.
 * @param item - The item, named by its manifest and id
 * @param edit - True for the edit page instead of the details page
 * @returns The route path
 */
export function itemRoute(item: ItemRef, edit: boolean = false): string {
  return `/items/${encodeURIComponent(item.ManifestId)}/${encodeURIComponent(item.Id)}${edit ? '/edit' : ''}`;
}
