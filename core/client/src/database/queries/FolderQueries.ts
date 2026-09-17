import { BaseQueries } from './BaseQueries';

/**
 * SQL query constants for Folder operations.
 * Centralizes all folder-related queries to avoid duplication.
 *
 * A folder is keyed by `(ManifestId, Id)` like every other manifest-scoped row, so each statement below
 * takes the folder's manifest as well as its id: two manifests may hold a folder with the same id, and
 * matching on the id alone would rename or delete the other manifest's folder along with this one.
 */
export class FolderQueries {
  /**
   * Get all active folders.
   */
  public static readonly GET_ALL = `
    SELECT Id, Name, ParentFolderId, Weight, ManifestId
    FROM Folders
    WHERE IsDeleted = 0
    ORDER BY Weight, Name`;

  /**
   * Get one folder by its manifest-qualified key.
   */
  public static readonly GET_BY_ID = `
    SELECT Id, Name, ParentFolderId, ManifestId
    FROM Folders
    WHERE Id = ? AND ManifestId = ? AND IsDeleted = 0`;

  /**
   * Insert a new folder, stamped with its parent folder's manifest.
   */
  public static readonly INSERT = `
    INSERT INTO Folders (Id, Name, ParentFolderId, ManifestId, Weight, IsDeleted, CreatedAt, UpdatedAt)
    VALUES (?, ?, ?, ${BaseQueries.MANIFEST_OF_FOLDER}, 0, 0, ?, ?)`;

  /**
   * Update folder name.
   */
  public static readonly UPDATE_NAME = `
    UPDATE Folders
    SET Name = ?,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Soft delete folder.
   */
  public static readonly SOFT_DELETE = `
    UPDATE Folders
    SET IsDeleted = 1,
        UpdatedAt = ?
    WHERE Id = ? AND ManifestId = ?`;

  /**
   * Clear folder reference from items (set to NULL). The manifest bound to the SET is the one an item
   * outside every folder joins; the one in the WHERE is the folder's own.
   */
  public static readonly CLEAR_ITEMS_FOLDER = `
    UPDATE Items
    SET FolderId = NULL,
        ManifestId = ?,
        UpdatedAt = ?
    WHERE FolderId = ? AND ManifestId = ?`;

  /**
   * Move items to a different folder.
   */
  public static readonly MOVE_ITEMS_TO_FOLDER = `
    UPDATE Items
    SET FolderId = ?,
        ManifestId = ${BaseQueries.MANIFEST_OF_FOLDER},
        UpdatedAt = ?
    WHERE FolderId = ? AND ManifestId = ?`;

  /**
   * Trash items in folder.
   */
  public static readonly TRASH_ITEMS_IN_FOLDER = `
    UPDATE Items
    SET DeletedAt = ?,
        UpdatedAt = ?,
        FolderId = NULL
    WHERE FolderId = ? AND ManifestId = ? AND IsDeleted = 0 AND DeletedAt IS NULL`;

  /**
   * Get all child folder IDs (direct children only), within the parent's own manifest.
   */
  public static readonly GET_CHILD_FOLDER_IDS = `
    SELECT Id
    FROM Folders
    WHERE ParentFolderId = ? AND ManifestId = ? AND IsDeleted = 0`;

  /**
   * Update parent folder for child folders.
   */
  public static readonly UPDATE_PARENT_FOLDER = `
    UPDATE Folders
    SET ParentFolderId = ?,
        UpdatedAt = ?
    WHERE ParentFolderId = ? AND ManifestId = ?`;
}
