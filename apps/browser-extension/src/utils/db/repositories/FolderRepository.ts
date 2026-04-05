import { BaseRepository } from '../BaseRepository';
import { FolderQueries } from '../queries/FolderQueries';

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
   * Get all child folder IDs recursively.
   * @param folderId - The parent folder ID
   * @returns Array of all descendant folder IDs
   */
  private getAllChildFolderIds(folderId: string): string[] {
    const directChildren = this.client.executeQuery<{ Id: string }>(
      FolderQueries.GET_CHILD_FOLDER_IDS,
      [folderId]
    );

    const allChildIds: string[] = [];

    for (const child of directChildren) {
      allChildIds.push(child.Id);
      // Recursively get all descendants
      const descendants = this.getAllChildFolderIds(child.Id);
      allChildIds.push(...descendants);
    }

    return allChildIds;
  }

  /**
   * Delete a folder (soft delete).
   * Handles child folders and items:
   * - Items in this folder only are moved to the parent folder (or root if no parent)
   * - Items in child folders stay in their respective folders (since child folders are moved to parent)
   * - All direct child folders are moved to the parent of the deleted folder
   * @param folderId - The ID of the folder to delete
   * @returns The number of rows updated
   */
  public async delete(folderId: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();

      // Get the parent folder of the folder being deleted
      const folder = this.getById(folderId);
      const targetParentId = folder?.ParentFolderId || null;

      // Move only items in this folder to the parent folder (or root if no parent)
      if (targetParentId) {
        // Has parent: move items to parent folder
        this.client.executeUpdate(FolderQueries.MOVE_ITEMS_TO_FOLDER, [
          targetParentId,
          currentDateTime,
          folderId
        ]);
      } else {
        // No parent: move items to root (NULL)
        this.client.executeUpdate(FolderQueries.CLEAR_ITEMS_FOLDER, [
          currentDateTime,
          folderId
        ]);
      }

      // Move direct child folders to the parent of the deleted folder
      this.client.executeUpdate(FolderQueries.UPDATE_PARENT_FOLDER, [
        targetParentId,
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
   * Recursively handles child folders:
   * - All items in this folder and child folders are moved to "Recently Deleted" (trash)
   * - All child folders are also deleted
   * @param folderId - The ID of the folder to delete
   * @returns The number of items trashed
   */
  public async deleteWithContents(folderId: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();

      // Get all child folder IDs recursively
      const allChildFolderIds = this.getAllChildFolderIds(folderId);

      let totalItemsDeleted = 0;

      // Move all items in this folder to trash
      totalItemsDeleted += this.client.executeUpdate(FolderQueries.TRASH_ITEMS_IN_FOLDER, [
        currentDateTime,
        currentDateTime,
        folderId
      ]);

      // Move all items in child folders to trash
      for (const childFolderId of allChildFolderIds) {
        totalItemsDeleted += this.client.executeUpdate(FolderQueries.TRASH_ITEMS_IN_FOLDER, [
          currentDateTime,
          currentDateTime,
          childFolderId
        ]);
      }

      // Soft delete all child folders
      for (const childFolderId of allChildFolderIds) {
        this.client.executeUpdate(FolderQueries.SOFT_DELETE, [
          currentDateTime,
          childFolderId
        ]);
      }

      // Soft delete the parent folder
      this.client.executeUpdate(FolderQueries.SOFT_DELETE, [
        currentDateTime,
        folderId
      ]);

      return totalItemsDeleted;
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
