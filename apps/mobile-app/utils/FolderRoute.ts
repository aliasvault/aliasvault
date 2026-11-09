import type { Href } from 'expo-router';

import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

/**
 * The route of a folder screen.
 * @param folder - The folder to open
 * @param filter - The active item filter to carry over, when any
 * @param name - The folder name, so the header shows it before the folder has loaded
 * @returns The route, as a href with the folder route's pattern and params
 */
export function folderRoute(folder: FolderRef, filter?: string, name?: string | null): Href {
  return { pathname: '/(tabs)/items/folder/[manifestId]/[id]', params: { manifestId: folder.ManifestId, id: folder.Id, ...(filter ? { filter } : {}), ...(name ? { name } : {}) } };
}
