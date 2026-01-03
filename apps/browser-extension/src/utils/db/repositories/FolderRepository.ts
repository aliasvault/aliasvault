import { BaseRepository } from '../BaseRepository';

/**
 * Folder entity type.
 */
export type Folder = {
  Id: string;
  Name: string;
  ParentFolderId: string | null;
  Weight: number;
}

/**
 * SQL query constants for Folder operations.
 */
const FolderQueries = {
  /**
   * Get all active folders.
   */
  GET_ALL: `
    SELECT Id, Name, ParentFolderId, Weight
    FROM Folders
    WHERE IsDeleted = 0
    ORDER BY Weight, Name`,

  /**
   * Get folder by ID.
   */
  GET_BY_ID: `
    SELECT Id, Name, ParentFolderId
    FROM Folders
    WHERE Id = ? AND IsDeleted = 0`,

  /**
   * Insert a new folder.
   */
  INSERT: `
    INSERT INTO Folders (Id, Name, ParentFolderId, Weight, IsDeleted, CreatedAt, UpdatedAt)
    VALUES (?, ?, ?, 0, 0, ?, ?)`,

  /**
   * Update folder name.
   */
  UPDATE_NAME: `
    UPDATE Folders
    SET Name = ?,
        UpdatedAt = ?
    WHERE Id = ?`,

  /**
   * Soft delete folder.
   */
  SOFT_DELETE: `
    UPDATE Folders
    SET IsDeleted = 1,
        UpdatedAt = ?
    WHERE Id = ?`,

  /**
   * Clear folder reference from items.
   */
  CLEAR_ITEMS_FOLDER: `
    UPDATE Items
    SET FolderId = NULL,
        UpdatedAt = ?
    WHERE FolderId = ?`,

  /**
   * Trash items in folder.
   */
  TRASH_ITEMS_IN_FOLDER: `
    UPDATE Items
    SET DeletedAt = ?,
        UpdatedAt = ?,
        FolderId = NULL
    WHERE FolderId = ? AND IsDeleted = 0 AND DeletedAt IS NULL`,

  /**
   * Move item to folder.
   */
  MOVE_ITEM: `
    UPDATE Items
    SET FolderId = ?,
        UpdatedAt = ?
    WHERE Id = ?`
};

/**
 * Repository for Folder CRUD operations.
 */
export class FolderRepository extends BaseRepository {
  /**
   * Create a new folder.
   * @param name - The name of the folder
   * @param parentFolderId - Optional parent folder ID for nested folders
   * @returns The ID of the created folder
   */
  public async create(name: string, parentFolderId?: string | null): Promise<string> {
    return this.withTransaction(async () => {
      const folderId = crypto.randomUUID().toUpperCase();
      const currentDateTime = this.now();

      this.client.executeUpdate(FolderQueries.INSERT, [
        folderId,
        name,
        parentFolderId || null,
        currentDateTime,
        currentDateTime
      ]);

      return folderId;
    });
  }

  /**
   * Get all folders.
   * @returns Array of folder objects (empty array if Folders table doesn't exist yet)
   */
  public getAll(): Folder[] {
    try {
      return this.client.executeQuery<Folder>(FolderQueries.GET_ALL);
    } catch (error) {
      // Table may not exist in older vault versions - return empty array
      if (error instanceof Error && error.message.includes('no such table')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get a folder by ID.
   * @param folderId - The ID of the folder
   * @returns Folder object or null if not found
   */
  public getById(folderId: string): Omit<Folder, 'Weight'> | null {
    const results = this.client.executeQuery<Omit<Folder, 'Weight'>>(
      FolderQueries.GET_BY_ID,
      [folderId]
    );
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Update a folder's name.
   * @param folderId - The ID of the folder to update
   * @param name - The new name for the folder
   * @returns The number of rows updated
   */
  public async update(folderId: string, name: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.client.executeUpdate(FolderQueries.UPDATE_NAME, [
        name,
        currentDateTime,
        folderId
      ]);
    });
  }

  /**
   * Delete a folder (soft delete).
   * Note: Items in the folder will have their FolderId set to NULL.
   * @param folderId - The ID of the folder to delete
   * @returns The number of rows updated
   */
  public async delete(folderId: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();

      // Remove folder reference from all items in this folder
      this.client.executeUpdate(FolderQueries.CLEAR_ITEMS_FOLDER, [
        currentDateTime,
        folderId
      ]);

      // Soft delete the folder
      return this.client.executeUpdate(FolderQueries.SOFT_DELETE, [
        currentDateTime,
        folderId
      ]);
    });
  }

  /**
   * Delete a folder and all items within it (soft delete both folder and items).
   * Items are moved to "Recently Deleted" (trash).
   * @param folderId - The ID of the folder to delete
   * @returns The number of items trashed
   */
  public async deleteWithContents(folderId: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();

      // Move all items in this folder to trash and clear FolderId
      const itemsDeleted = this.client.executeUpdate(FolderQueries.TRASH_ITEMS_IN_FOLDER, [
        currentDateTime,
        currentDateTime,
        folderId
      ]);

      // Soft delete the folder
      this.client.executeUpdate(FolderQueries.SOFT_DELETE, [
        currentDateTime,
        folderId
      ]);

      return itemsDeleted;
    });
  }

  /**
   * Move an item to a folder.
   * @param itemId - The ID of the item to move
   * @param folderId - The ID of the destination folder (null to remove from folder)
   * @returns The number of rows updated
   */
  public async moveItem(itemId: string, folderId: string | null): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.client.executeUpdate(FolderQueries.MOVE_ITEM, [
        folderId,
        currentDateTime,
        itemId
      ]);
    });
  }
}
