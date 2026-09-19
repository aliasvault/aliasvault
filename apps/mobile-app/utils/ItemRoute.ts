import type { ItemRef } from '@aliasvault/client/database/ItemRef';

/**
 * The route of an item's detail screen. An item id alone does not name one item, so its manifest is a path segment too.
 * @param item - The item to open
 * @returns The route, typed as the item screen's
 */
export function itemRoute(item: ItemRef): '/(tabs)/items/[manifestId]/[id]' {
  return `/(tabs)/items/${encodeURIComponent(item.ManifestId)}/${item.Id}` as '/(tabs)/items/[manifestId]/[id]';
}

/**
 * The route that edits an existing item.
 * @param item - The item to edit
 * @returns The route, typed as the edit screen's
 */
export function itemEditRoute(item: ItemRef): '/(tabs)/items/[manifestId]/[id]/edit' {
  return `/(tabs)/items/${encodeURIComponent(item.ManifestId)}/${item.Id}/edit` as '/(tabs)/items/[manifestId]/[id]/edit';
}
