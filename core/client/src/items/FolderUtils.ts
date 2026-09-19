import { scopedKey } from '../database/ItemRef';

import type { Folder, FolderRef } from '../database/repositories/FolderRepository';

/**
 * Maximum allowed folder nesting depth.
 * Structure: Root (0) > Level 1 (1) > Level 2 (2) > Level 3 (3) > Level 4 (4)
 * Folders at depth 4 cannot have subfolders.
 */
export const MAX_FOLDER_DEPTH = 4;

/**
 * Folder tree node with hierarchical structure.
 */
export type FolderTreeNode = Folder & {
  children: FolderTreeNode[];
  depth: number;
  path: string[]; // Array of folder IDs from root to this folder
};

/**
 * The folders of one manifest. A folder is keyed by (ManifestId, Id) and a folder tree never crosses a
 * manifest, so every walk below stays inside the manifest of the folder it starts from.
 * @param manifestId - The manifest to keep
 * @param folders - Flat array of all folders
 * @returns The folders stamped for that manifest
 */
function foldersOfManifest(manifestId: string, folders: Folder[]): Folder[] {
  return folders.filter(f => f.ManifestId === manifestId);
}

/**
 * Whether an item sits directly in the given folder.
 * @param item - The item to test
 * @param folder - The folder
 * @returns True when the item names this folder inside the folder's own manifest
 */
export function isItemInFolder(item: { FolderId?: string | null; ManifestId?: string | null }, folder: FolderRef): boolean {
  return item.FolderId === folder.Id && item.ManifestId === folder.ManifestId;
}

/**
 * Whether a folder is shared with other people rather than the user's own.
 * @param folder - The folder to classify
 * @param personalManifestId - The user's personal manifest id, or null when no pull has recorded one yet
 * @returns True when the folder belongs to a manifest shared with other people
 */
export function isSharedFolder(folder: Pick<Folder, 'ManifestId'>, personalManifestId: string | null | undefined): boolean {
  return Boolean(personalManifestId && folder.ManifestId && folder.ManifestId !== personalManifestId);
}

/**
 * Build a hierarchical tree from a flat array of folders.
 * @param folders - Flat array of folders
 * @returns Array of root-level folder tree nodes
 */
export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  // Create a map for quick lookup
  const folderMap = new Map<string, FolderTreeNode>();

  // Initialize all folders as tree nodes
  folders.forEach(folder => {
    folderMap.set(scopedKey(folder.ManifestId, folder.Id), {
      ...folder,
      children: [],
      depth: 0,
      path: []
    });
  });

  // Build the tree structure
  const rootFolders: FolderTreeNode[] = [];

  folders.forEach(folder => {
    const node = folderMap.get(scopedKey(folder.ManifestId, folder.Id))!;

    if (!folder.ParentFolderId) {
      // Root folder
      node.depth = 0;
      node.path = [folder.Id];
      rootFolders.push(node);
    } else {
      // Child folder
      const parent = folderMap.get(scopedKey(folder.ManifestId, folder.ParentFolderId));
      if (parent) {
        node.depth = parent.depth + 1;
        node.path = [...parent.path, folder.Id];
        parent.children.push(node);
      } else {
        // Parent not found or deleted - treat as root
        node.depth = 0;
        node.path = [folder.Id];
        rootFolders.push(node);
      }
    }
  });

  /**
   * Sort children of a folder tree node recursively.
   */
  const sortChildren = (nodes: FolderTreeNode[]): void => {
    nodes.sort((a, b) => {
      // Sort by weight first, then by name (case-insensitive)
      if (a.Weight !== b.Weight) {
        return a.Weight - b.Weight;
      }
      return a.Name.localeCompare(b.Name, undefined, { sensitivity: 'base' });
    });
    nodes.forEach(node => sortChildren(node.children));
  };

  sortChildren(rootFolders);

  return rootFolders;
}

/**
 * Get folder depth in the hierarchy.
 * @param ref - The folder to check
 * @param allFolders - Flat array of all folders
 * @returns Depth (0 = root, 1 = one level deep, etc.) or null if folder not found
 */
export function getFolderDepth(ref: FolderRef, allFolders: Folder[]): number | null {
  const folders = foldersOfManifest(ref.ManifestId, allFolders);
  const folder = folders.find(f => f.Id === ref.Id);
  if (!folder) {
    return null;
  }

  let depth = 0;
  let currentId: string | null = ref.Id;

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
 * @param ref - The folder, or null for none
 * @param allFolders - Flat array of all folders
 * @returns Array of folder names from root to current folder, or empty array if not found
 */
export function getFolderPath(ref: FolderRef | null, allFolders: Folder[]): string[] {
  if (!ref) {
    return [];
  }

  const folders = foldersOfManifest(ref.ManifestId, allFolders);

  const path: string[] = [];
  let currentId: string | null = ref.Id;
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
 * @param ref - The folder, or null for none
 * @param allFolders - Flat array of all folders
 * @returns Array of folder IDs from root to current folder, or empty array if not found
 */
export function getFolderIdPath(ref: FolderRef | null, allFolders: Folder[]): string[] {
  if (!ref) {
    return [];
  }

  const folders = foldersOfManifest(ref.ManifestId, allFolders);

  const path: string[] = [];
  let currentId: string | null = ref.Id;
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
 * Truncate a folder path for display, keeping first and last segments.
 * Example: "Work > Projects > Client A > Project X > Credentials" -> "Work > ... > Credentials"
 * @param pathSegments - Array of folder names
 * @param maxSegments - Maximum number of segments to show (default: 3)
 * @returns Truncated path segments
 */
export function truncateFolderPath(pathSegments: string[], maxSegments: number = 3): string[] {
  if (pathSegments.length <= maxSegments) {
    return pathSegments;
  }

  // Show first segment, "...", and last segment
  if (maxSegments === 2) {
    return [pathSegments[0], '...', pathSegments[pathSegments.length - 1]];
  }

  // Show first 2 segments, "...", and last segment
  if (maxSegments === 3) {
    return [pathSegments[0], '...', pathSegments[pathSegments.length - 1]];
  }

  // For more segments, distribute them
  const firstCount = Math.ceil((maxSegments - 1) / 2);
  const lastCount = Math.floor((maxSegments - 1) / 2);

  return [
    ...pathSegments.slice(0, firstCount),
    '...',
    ...pathSegments.slice(-lastCount)
  ];
}

/**
 * Check if a folder can have subfolders (not at max depth).
 * @param ref - The folder to check
 * @param folders - Flat array of all folders
 * @returns True if folder can have children, false otherwise
 */
export function canHaveSubfolders(ref: FolderRef, folders: Folder[]): boolean {
  const depth = getFolderDepth(ref, folders);
  return depth !== null && depth < MAX_FOLDER_DEPTH;
}

/**
 * Get all descendant folder IDs (children, grandchildren, etc.).
 * @param ref - The parent folder
 * @param allFolders - Flat array of all folders
 * @returns Array of descendant folder IDs, all inside the parent's own manifest
 */
export function getDescendantFolderIds(ref: FolderRef, allFolders: Folder[]): string[] {
  const folders = foldersOfManifest(ref.ManifestId, allFolders);
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

  traverse(ref.Id);
  return descendants;
}

/**
 * Get total count of items in a folder and all its subfolders.
 * @param ref - The folder to count items for
 * @param allItems - All items in the vault
 * @param allFolders - All folders in the vault
 * @returns Total item count including subfolders
 */
export function getRecursiveItemCount(
  ref: FolderRef,
  allItems: Array<{ FolderId?: string | null; ManifestId?: string | null }>,
  allFolders: Folder[]
): number {
  // Get all descendant folder IDs
  const descendantIds = getDescendantFolderIds(ref, allFolders);
  const allFolderIds = [ref.Id, ...descendantIds];

  // Count items in current folder and all descendants, which share the folder's manifest
  return allItems.filter(item => item.ManifestId === ref.ManifestId && item.FolderId && allFolderIds.includes(item.FolderId)).length;
}
