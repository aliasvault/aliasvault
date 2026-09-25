import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

/**
 * The route of a folder screen.
 * @param folder - The folder to open
 * @param filter - The active item filter to carry over, when any
 * @returns The route, typed as the folder screen's
 */
export function folderRoute(folder: FolderRef, filter?: string): '/(tabs)/items/folder/[manifestId]/[id]' {
  const filterParam = filter ? `?filter=${encodeURIComponent(filter)}` : '';
  return `/(tabs)/items/folder/${encodeURIComponent(folder.ManifestId)}/${folder.Id}${filterParam}` as '/(tabs)/items/folder/[manifestId]/[id]';
}
