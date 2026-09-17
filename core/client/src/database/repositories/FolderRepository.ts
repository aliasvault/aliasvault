import { getPlatform } from '../../platform/ClientPlatform';
import { TranslatableMessage } from '../../platform/TranslatableMessage';
import { multiManifestRendering } from '../../sharing/MultiManifestRendering';
import { BaseRepository } from '../BaseRepository';
import { FolderQueries } from '../queries/FolderQueries';

import type { DbOp } from '../DbOp';

/**
 * Folder entity type.
 */
export type Folder = {
  Id: string;
  Name: string;
  ParentFolderId: string | null;
  Weight: number;
  ManifestId?: string | null;
}

/**
 * Repository for Folder CRUD operations.
 */
export class FolderRepository extends BaseRepository {
  /**
   * Create a new folder.
   * @param name - The name of the folder
   * @param parentFolderId - Optional parent folder ID for nested folders
   * @param id - Optional explicit folder ID (used when the id must be known before creation, e.g. the folder a
   *   shared manifest is rendered as); a new GUID is generated when omitted.
   * @returns The ID of the created folder
   */
  public async create(name: string, parentFolderId?: string | null, id?: string): Promise<string> {
    return this.withTransaction(async () => {
      const folderId = id ?? crypto.randomUUID();
      const currentDateTime = this.now();
      const manifestId = await this.run(this.writeManifestId());

      await this.run(this.execute(FolderQueries.INSERT, [
        folderId,
        name,
        parentFolderId || null,
        // Second bind of the parent id, then the manifest a top-level folder joins (see INSERT).
        parentFolderId || null,
        manifestId,
        currentDateTime,
        currentDateTime
      ]));

      return folderId;
    });
  }

  /**
   * Get all folders.
   * @returns Array of folder objects (empty array if Folders table doesn't exist yet)
   */
  public *getAll(): DbOp<Folder[]> {
    try {
      return yield* this.query<Folder>(FolderQueries.GET_ALL);
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
  public *getById(folderId: string): DbOp<Omit<Folder, 'Weight'> | null> {
    const results = yield* this.query<Omit<Folder, 'Weight'>>(FolderQueries.GET_BY_ID, [folderId]);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Update a folder's name.
   * @param folderId - The ID of the folder to update
   * @param name - The new name for the folder
   * @returns The number of rows updated
   */
  public async update(folderId: string, name: string): Promise<number> {
    return this.withTransaction(() => this.run(this.execute(FolderQueries.UPDATE_NAME, [name, this.now(), folderId])));
  }

  /**
   * Get all child folder IDs recursively.
   * @param folderId - The parent folder ID
   * @returns Array of all descendant folder IDs
   */
  private *getAllChildFolderIds(folderId: string): DbOp<string[]> {
    const directChildren = yield* this.query<{ Id: string }>(FolderQueries.GET_CHILD_FOLDER_IDS, [folderId]);

    const allChildIds: string[] = [];

    for (const child of directChildren) {
      allChildIds.push(child.Id);
      // Recursively get all descendants
      allChildIds.push(...(yield* this.getAllChildFolderIds(child.Id)));
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
    await this.assertDeletable(folderId);
    return this.withTransaction(() => this.run(this.deleteKeepingContents(folderId)));
  }

  /**
   * Soft delete a folder, moving its items and child folders up to its parent.
   * @param folderId - The ID of the folder to delete
   * @returns The number of rows updated
   */
  private *deleteKeepingContents(folderId: string): DbOp<number> {
    const currentDateTime = this.now();

    // Get the parent folder of the folder being deleted
    const folder = yield* this.getById(folderId);
    const targetParentId = folder?.ParentFolderId || null;
    const manifestId = yield* this.writeManifestId();

    // Move only items in this folder to the parent folder (or root if no parent)
    if (targetParentId) {
      // Has parent: move items to parent folder
      yield* this.execute(FolderQueries.MOVE_ITEMS_TO_FOLDER, [
        targetParentId,
        // Second bind of the destination: the items adopt that folder's manifest.
        targetParentId,
        manifestId,
        currentDateTime,
        folderId
      ]);
    } else {
      // No parent: move items to root (NULL); out of every folder means into the default manifest.
      yield* this.execute(FolderQueries.CLEAR_ITEMS_FOLDER, [manifestId, currentDateTime, folderId]);
    }

    // Move direct child folders to the parent of the deleted folder
    yield* this.execute(FolderQueries.UPDATE_PARENT_FOLDER, [targetParentId, currentDateTime, folderId]);

    // Soft delete the folder
    return yield* this.execute(FolderQueries.SOFT_DELETE, [currentDateTime, folderId]);
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
    await this.assertDeletable(folderId);
    return this.withTransaction(() => this.run(this.deleteFolderTree(folderId)));
  }

  /**
   * Soft delete a folder and its child folders, moving every item inside them to the trash.
   * @param folderId - The ID of the folder to delete
   * @returns The number of items trashed
   */
  private *deleteFolderTree(folderId: string): DbOp<number> {
    const currentDateTime = this.now();
    const allChildFolderIds = yield* this.getAllChildFolderIds(folderId);

    let totalItemsDeleted = 0;

    // Move all items in this folder and in its child folders to trash
    for (const id of [folderId, ...allChildFolderIds]) {
      totalItemsDeleted += yield* this.execute(FolderQueries.TRASH_ITEMS_IN_FOLDER, [currentDateTime, currentDateTime, id]);
    }

    // Soft delete all child folders, then the folder itself
    for (const id of [...allChildFolderIds, folderId]) {
      yield* this.execute(FolderQueries.SOFT_DELETE, [currentDateTime, id]);
    }

    return totalItemsDeleted;
  }

  /**
   * Refuse to delete a folder that a shared manifest is rendered as (see {@link multiManifestRendering}).
   * @param folderId - The folder about to be deleted
   */
  private async assertDeletable(folderId: string): Promise<void> {
    const folder = await this.run(this.getById(folderId));
    if (folder && multiManifestRendering.isManifestRoot(folder)) {
      throw new Error(await getPlatform().translate(TranslatableMessage.SharedFolderDeleteRefused));
    }
  }
}
