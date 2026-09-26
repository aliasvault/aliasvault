import { isBlank } from './StringUtils';

/** The deepest folder level an import creates (matches AliasVault's UI limit). */
const MAX_FOLDER_DEPTH = 5;

/**
 * The fields of a folder that make up its path.
 */
export type FolderNode = {
  Name: string | null;
  ParentFolderId: string | null | undefined;
};

/**
 * The full path of a folder, walking up its parents: "Work/Projects/Active".
 * @param folderId - The folder id
 * @param foldersById - Every folder by id
 * @returns The path, or the empty string when the folder is unknown
 */
export function buildFolderPath(folderId: string | null | undefined, foldersById: ReadonlyMap<string, FolderNode>): string {
  const parts: string[] = [];
  const visited = new Set<string>();
  let id = folderId;
  while (id && !visited.has(id)) {
    const folder = foldersById.get(id);
    if (!folder) {
      break;
    }
    visited.add(id);
    parts.unshift(folder.Name ?? '');
    id = folder.ParentFolderId;
  }
  return parts.join('/');
}

/**
 * Split a folder path into its folder names, at most five levels deep: "Root/Business/Banking" results in ["Root", "Business", "Banking"].
 * @param folderPath - The folder path, with "/" or "\" separators
 * @returns The folder names in order, empty when there are none
 */
export function parseFolderPath(folderPath: string | null | undefined): string[] {
  if (isBlank(folderPath)) {
    return [];
  }
  return folderPath.split(/[/\\]/).map(part => part.trim()).filter(part => part.length > 0).slice(0, MAX_FOLDER_DEPTH);
}
