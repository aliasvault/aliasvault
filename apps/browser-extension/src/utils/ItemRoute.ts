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

/**
 * Whether two references name the same item: same id inside the same manifest.
 * @param a - One item
 * @param b - The other item
 * @returns True when both halves match
 */
export function isSameItem(a: ItemRef, b: ItemRef): boolean {
  return a.Id === b.Id && a.ManifestId === b.ManifestId;
}
