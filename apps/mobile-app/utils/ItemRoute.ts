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

/**
 * The route that merges an item with another one, picked on the screen unless given.
 * @param item - The item to merge
 * @param other - The item to merge it with
 * @returns The route, typed as the merge screen's
 */
export function itemMergeRoute(item: ItemRef, other?: ItemRef): '/(tabs)/items/[manifestId]/[id]/merge' {
  const query = other ? `?otherManifestId=${encodeURIComponent(other.ManifestId)}&otherId=${other.Id}` : '';
  return `/(tabs)/items/${encodeURIComponent(item.ManifestId)}/${item.Id}/merge${query}` as '/(tabs)/items/[manifestId]/[id]/merge';
}
