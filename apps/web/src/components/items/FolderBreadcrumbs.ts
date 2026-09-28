import { getFolderIdPath } from '@aliasvault/client/items/FolderUtils';

import type { BreadcrumbItem } from '@/components/shared/Breadcrumb';
import { folderRoute } from '@/utils/ItemRoute';

import type { Folder, FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';

/**
 * Breadcrumbs for the folder chain from the root to a folder.
 * @param ref - the folder
 * @param folders - all folders
 * @param makeLastClickable - whether the last folder links to itself
 */
export function buildFolderBreadcrumbs(ref: FolderRef, folders: Folder[], makeLastClickable: boolean = true): BreadcrumbItem[] {
  const idPath = getFolderIdPath(ref, folders);
  return idPath.flatMap((id, index) => {
    const folder = folders.find(f => f.Id === id && f.ManifestId === ref.ManifestId);
    if (!folder) {
      return [];
    }
    const clickable = index < idPath.length - 1 || makeLastClickable;
    return [{ displayName: folder.Name, url: clickable ? folderRoute(folder) : undefined }];
  });
}
