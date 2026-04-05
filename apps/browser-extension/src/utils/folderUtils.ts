import type { Folder } from './db/repositories/FolderRepository';

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
 * Build a hierarchical tree from a flat array of folders.
 * @param folders - Flat array of folders
 * @returns Array of root-level folder tree nodes
 */
export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  // Create a map for quick lookup
  const folderMap = new Map<string, FolderTreeNode>();

  // Initialize all folders as tree nodes
  folders.forEach(folder => {
    folderMap.set(folder.Id, {
      ...folder,
      children: [],
      depth: 0,
      path: []
    });
  });

  // Build the tree structure
  const rootFolders: FolderTreeNode[] = [];

  folders.forEach(folder => {
    const node = folderMap.get(folder.Id)!;

    if (!folder.ParentFolderId) {
      // Root folder
      node.depth = 0;
      node.path = [folder.Id];
      rootFolders.push(node);
    } else {
      // Child folder
      const parent = folderMap.get(folder.ParentFolderId);
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
 * Format folder path for display with separator.
 * @param pathSegments - Array of folder names
 * @param separator - Separator string (default: " > ")
 * @param truncate - Whether to truncate long paths (default: false)
 * @returns Formatted folder path string
 */
export function formatFolderPath(
  pathSegments: string[],
  separator: string = ' > ',
  truncate: boolean = false
): string {
  const segments = truncate ? truncateFolderPath(pathSegments) : pathSegments;
  return segments.join(separator);
}

/**
 * Flatten a folder tree into a sorted array suitable for dropdowns.
 * Includes visual indentation in the name.
 * @param tree - Root-level folder tree nodes
 * @param excludeId - Optional folder ID to exclude (useful when moving folders)
 * @returns Flat array of folders with indented names
 */
export function flattenFolderTree(
  tree: FolderTreeNode[],
  excludeId?: string
): Array<Folder & { indentedName: string; depth: number }> {
  const result: Array<Folder & { indentedName: string; depth: number }> = [];

  /**
   * Traverse a folder tree and flatten it into a sorted array.
   */
  const traverse = (nodes: FolderTreeNode[]): void => {
    nodes.forEach(node => {
      if (node.Id === excludeId) {
        return; // Skip excluded folder and its children
      }

      const indent = '  '.repeat(node.depth); // Two spaces per level
      result.push({
        Id: node.Id,
        Name: node.Name,
        ParentFolderId: node.ParentFolderId,
        Weight: node.Weight,
        indentedName: `${indent}${node.Name}`,
        depth: node.depth
      });

      traverse(node.children);
    });
  };

  traverse(tree);
  return result;
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
