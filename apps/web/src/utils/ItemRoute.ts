import type { ItemRef } from '@aliasvault/client/database/ItemRef';
import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

/**
 * The route of an item.
 * @param item - The item, named by its manifest and id
 * @param edit - True for the edit page instead of the details page
 * @returns The route path
 */
export function itemRoute(item: ItemRef, edit: boolean = false): string {
  return `/items/${encodeURIComponent(item.ManifestId)}/${encodeURIComponent(item.Id)}${edit ? '/edit' : ''}`;
}

/**
 * The route of a folder's item list.
 * @param folder - The folder, named by its manifest and id
 * @returns The route path
 */
export function folderRoute(folder: FolderRef): string {
  return `/items/folder/${encodeURIComponent(folder.ManifestId)}/${encodeURIComponent(folder.Id)}`;
}
