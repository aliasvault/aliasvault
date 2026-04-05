/**
 * SQL query constants for Folder operations.
 * Centralizes all folder-related queries to avoid duplication.
 */
export class FolderQueries {
  /**
   * Get all active folders.
   */
  public static readonly GET_ALL = `
    SELECT Id, Name, ParentFolderId, Weight
    FROM Folders
    WHERE IsDeleted = 0
    ORDER BY Weight, Name`;

  /**
   * Get folder by ID.
   */
  public static readonly GET_BY_ID = `
    SELECT Id, Name, ParentFolderId
    FROM Folders
    WHERE Id = ? AND IsDeleted = 0`;

  /**
   * Insert a new folder.
   */
  public static readonly INSERT = `
    INSERT INTO Folders (Id, Name, ParentFolderId, Weight, IsDeleted, CreatedAt, UpdatedAt)
    VALUES (?, ?, ?, 0, 0, ?, ?)`;

  /**
   * Update folder name.
   */
  public static readonly UPDATE_NAME = `
    UPDATE Folders
    SET Name = ?,
        UpdatedAt = ?
    WHERE Id = ?`;

  /**
   * Soft delete folder.
   */
  public static readonly SOFT_DELETE = `
    UPDATE Folders
    SET IsDeleted = 1,
        UpdatedAt = ?
    WHERE Id = ?`;

  /**
   * Clear folder reference from items (set to NULL).
   */
  public static readonly CLEAR_ITEMS_FOLDER = `
    UPDATE Items
    SET FolderId = NULL,
        UpdatedAt = ?
    WHERE FolderId = ?`;

  /**
   * Move items to a different folder.
   */
  public static readonly MOVE_ITEMS_TO_FOLDER = `
    UPDATE Items
    SET FolderId = ?,
        UpdatedAt = ?
    WHERE FolderId = ?`;

  /**
   * Trash items in folder.
   */
  public static readonly TRASH_ITEMS_IN_FOLDER = `
    UPDATE Items
    SET DeletedAt = ?,
        UpdatedAt = ?,
        FolderId = NULL
    WHERE FolderId = ? AND IsDeleted = 0 AND DeletedAt IS NULL`;

  /**
   * Get all child folder IDs (direct children only).
   */
  public static readonly GET_CHILD_FOLDER_IDS = `
    SELECT Id
    FROM Folders
    WHERE ParentFolderId = ? AND IsDeleted = 0`;

  /**
   * Update parent folder for child folders.
   */
  public static readonly UPDATE_PARENT_FOLDER = `
    UPDATE Folders
    SET ParentFolderId = ?,
        UpdatedAt = ?
    WHERE ParentFolderId = ?`;

  /**
   * Move item to folder.
   */
  public static readonly MOVE_ITEM = `
    UPDATE Items
    SET FolderId = ?,
        UpdatedAt = ?
    WHERE Id = ?`;
}
