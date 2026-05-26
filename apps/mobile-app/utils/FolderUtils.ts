import type { Folder } from './db/repositories/FolderRepository';

/**
 * Maximum allowed folder nesting depth.
 * Structure: Root (0) > Level 1 (1) > Level 2 (2) > Level 3 (3) > Level 4 (4)
 * Folders at depth 4 cannot have subfolders.
 */
export const MAX_FOLDER_DEPTH = 4;

/**
 * Get folder depth in the hierarchy.
 * @param folderId - The folder ID to check
 * @param folders - Flat array of all folders
 * @returns Depth (0 = root, 1 = one level deep, etc.) or null if folder not found
 */
export function getFolderDepth(folderId: string, folders: Folder[]): number | null {
  const folder = folders.find(f => f.Id === folderId);
  if (!folder) {
    return null;
  }

  let depth = 0;
  let currentId: string | null = folderId;

  // Traverse up to root, counting levels
  while (currentId) {
    const current = folders.find(f => f.Id === currentId);
    if (!current || !current.ParentFolderId) {
      break;
    }
    depth++;
    currentId = current.ParentFolderId;

    // Prevent infinite loops
    if (depth > MAX_FOLDER_DEPTH) {
      break;
    }
  }

  return depth;
}

/**
 * Get the full path of folder names from root to the specified folder.
 * @param folderId - The folder ID
 * @param folders - Flat array of all folders
 * @returns Array of folder names from root to current folder, or empty array if not found
 */
export function getFolderPath(folderId: string | null, folders: Folder[]): string[] {
  if (!folderId) {
    return [];
  }

  const path: string[] = [];
  let currentId: string | null = folderId;
  let iterations = 0;

  // Build path by traversing up to root
  while (currentId && iterations < MAX_FOLDER_DEPTH + 1) {
    const folder = folders.find(f => f.Id === currentId);
    if (!folder) {
      break;
    }
    path.unshift(folder.Name); // Add to beginning of array
    currentId = folder.ParentFolderId;
    iterations++;
  }

  return path;
}

/**
 * Get the full path of folder IDs from root to the specified folder.
 * @param folderId - The folder ID
 * @param folders - Flat array of all folders
 * @returns Array of folder IDs from root to current folder, or empty array if not found
 */
export function getFolderIdPath(folderId: string | null, folders: Folder[]): string[] {
  if (!folderId) {
    return [];
  }

  const path: string[] = [];
  let currentId: string | null = folderId;
  let iterations = 0;

  // Build path by traversing up to root
  while (currentId && iterations < MAX_FOLDER_DEPTH + 1) {
    const folder = folders.find(f => f.Id === currentId);
    if (!folder) {
      break;
    }
    path.unshift(folder.Id); // Add to beginning of array
    currentId = folder.ParentFolderId;
    iterations++;
  }

  return path;
}

/**
 * Format folder path for display with separator.
 * @param pathSegments - Array of folder names
 * @param separator - Separator string (default: " > ")
 * @returns Formatted folder path string
 */
export function formatFolderPath(
  pathSegments: string[],
  separator: string = ' > '
): string {
  return pathSegments.join(separator);
}

/**
 * Check if a folder can have subfolders (not at max depth).
 * @param folderId - The folder ID to check
 * @param folders - Flat array of all folders
 * @returns True if folder can have children, false otherwise
 */
export function canHaveSubfolders(folderId: string, folders: Folder[]): boolean {
  const depth = getFolderDepth(folderId, folders);
  return depth !== null && depth < MAX_FOLDER_DEPTH;
}

/**
 * Get all descendant folder IDs (children, grandchildren, etc.).
 * @param folderId - The parent folder ID
 * @param folders - Flat array of all folders
 * @returns Array of descendant folder IDs
 */
export function getDescendantFolderIds(folderId: string, folders: Folder[]): string[] {
  const descendants: string[] = [];

  /**
   * Traverse a folder tree and get all descendant folder IDs.
   */
  const traverse = (parentId: string): void => {
    folders
      .filter(f => f.ParentFolderId === parentId)
      .forEach(child => {
        descendants.push(child.Id);
        traverse(child.Id);
      });
  };

  traverse(folderId);
  return descendants;
}

/**
 * Get all direct child folder IDs.
 * @param parentFolderId - The parent folder ID (null for root)
 * @param folders - Flat array of all folders
 * @returns Array of direct child folder IDs
 */
export function getDirectChildFolderIds(parentFolderId: string | null, folders: Folder[]): string[] {
  return folders
    .filter(f => f.ParentFolderId === parentFolderId)
    .map(f => f.Id);
}

/**
 * Get total count of items in a folder and all its subfolders.
 * @param folderId - The folder ID to count items for
 * @param allItems - All items in the vault
 * @param allFolders - All folders in the vault
 * @returns Total item count including subfolders
 */
export function getRecursiveItemCount(
  folderId: string,
  allItems: Array<{ FolderId?: string | null }>,
  allFolders: Folder[]
): number {
  // Get all descendant folder IDs
  const descendantIds = getDescendantFolderIds(folderId, allFolders);
  const allFolderIds = [folderId, ...descendantIds];

  // Count items in current folder and all descendants
  return allItems.filter(item => item.FolderId && allFolderIds.includes(item.FolderId)).length;
}
