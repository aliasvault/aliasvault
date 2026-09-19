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
  ManifestId: string;
}

/**
 * A manifest-qualified reference to a folder: folders are keyed by `(ManifestId, Id)`, so an id on its
 * own does not name one folder.
 */
export type FolderRef = {
  Id: string;
  ManifestId: string;
}

/**
 * Repository for Folder CRUD operations.
 */
export class FolderRepository extends BaseRepository {
  /**
   * Create a new folder inside its parent's manifest, or the personal manifest (default) when there is no parent.
   * @param name - The name of the folder
   * @param parent - The parent folder for a nested folder, or null for a top-level one
   * @param id - Optional explicit folder ID; a new GUID is generated when omitted
   * @returns The ID of the created folder
   */
  public async create(name: string, parent: FolderRef | null = null, id?: string): Promise<string> {
    return this.withTransaction(async () => {
      const folderId = id ?? crypto.randomUUID();
      const currentDateTime = this.now();

      if (parent) {
        await this.run(this.assertExists(parent));
      }
      const manifestId = parent?.ManifestId ?? await this.run(this.writeManifestId());

      await this.run(this.execute(FolderQueries.INSERT, [folderId, name, parent?.Id ?? null, manifestId, currentDateTime, currentDateTime]));

      return folderId;
    });
  }

  /**
   * Reject a folder reference that does not exist.
   * @param ref - The folder to check
   */
  public *assertExists(ref: FolderRef): DbOp<void> {
    const folder = yield* this.getById(ref);
    if (!folder) {
      throw new Error(`FolderRepository: folder ${ref.Id} does not exist in manifest ${ref.ManifestId}; refusing the write.`);
    }
  }
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
   * Get a folder by its manifest-qualified reference.
   * @param ref - The folder to read
   * @returns Folder object or null if not found
   */
  public *getById(ref: FolderRef): DbOp<Omit<Folder, 'Weight'> | null> {
    const results = yield* this.query<Omit<Folder, 'Weight'>>(FolderQueries.GET_BY_ID, [ref.Id, ref.ManifestId]);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Update a folder's name.
   * @param ref - The folder to update
   * @param name - The new name for the folder
   * @returns The number of rows updated
   */
  public async update(ref: FolderRef, name: string): Promise<number> {
    return this.withTransaction(() => this.run(this.execute(FolderQueries.UPDATE_NAME, [name, this.now(), ref.Id, ref.ManifestId])));
  }

  /**
   * Get all child folder IDs recursively. A folder tree never crosses a manifest, so every descendant is
   * looked up inside the root folder's own manifest.
   * @param folderId - The parent folder ID
   * @param manifestId - The manifest the folder tree lives in
   * @returns Array of all descendant folder IDs
   */
  private *getAllChildFolderIds(folderId: string, manifestId: string): DbOp<string[]> {
    const directChildren = yield* this.query<{ Id: string }>(FolderQueries.GET_CHILD_FOLDER_IDS, [folderId, manifestId]);

    const allChildIds: string[] = [];

    for (const child of directChildren) {
      allChildIds.push(child.Id);
      // Recursively get all descendants
      allChildIds.push(...(yield* this.getAllChildFolderIds(child.Id, manifestId)));
    }

    return allChildIds;
  }

  /**
   * Delete a folder (soft delete).
   * Handles child folders and items:
   * - Items in this folder only are moved to the parent folder (or root if no parent)
   * - Items in child folders stay in their respective folders (since child folders are moved to parent)
   * - All direct child folders are moved to the parent of the deleted folder
   * @param ref - The folder to delete
   * @returns The number of rows updated
   */
  public async delete(ref: FolderRef): Promise<number> {
    await this.assertDeletable(ref);
    return this.withTransaction(() => this.run(this.deleteKeepingContents(ref)));
  }

  /**
   * Soft delete a folder, moving its items and child folders up to its parent.
   * @param ref - The folder to delete
   * @returns The number of rows updated
   */
  private *deleteKeepingContents(ref: FolderRef): DbOp<number> {
    const currentDateTime = this.now();

    // Get the parent folder of the folder being deleted
    const folder = yield* this.getById(ref);
    const targetParentId = folder?.ParentFolderId || null;
    const manifestId = yield* this.writeManifestId();

    // Move only items in this folder to the parent folder (or root if no parent)
    if (targetParentId) {
      // Has parent: move items to the parent folder, which a folder tree keeps in the same manifest
      yield* this.execute(FolderQueries.MOVE_ITEMS_TO_FOLDER, [targetParentId, currentDateTime, ref.Id, ref.ManifestId]);
    } else {
      // No parent: move items to root (NULL); out of every folder means into the default manifest.
      yield* this.execute(FolderQueries.CLEAR_ITEMS_FOLDER, [manifestId, currentDateTime, ref.Id, ref.ManifestId]);
    }

    // Move direct child folders to the parent of the deleted folder
    yield* this.execute(FolderQueries.UPDATE_PARENT_FOLDER, [targetParentId, currentDateTime, ref.Id, ref.ManifestId]);

    // Soft delete the folder
    return yield* this.execute(FolderQueries.SOFT_DELETE, [currentDateTime, ref.Id, ref.ManifestId]);
  }

  /**
   * Delete a folder and all items within it (soft delete both folder and items).
   * Recursively handles child folders:
   * - All items in this folder and child folders are moved to "Recently Deleted" (trash)
   * - All child folders are also deleted
   * @param ref - The folder to delete
   * @returns The number of items trashed
   */
  public async deleteWithContents(ref: FolderRef): Promise<number> {
    await this.assertDeletable(ref);
    return this.withTransaction(() => this.run(this.deleteFolderTree(ref)));
  }

  /**
   * Soft delete a folder and its child folders, moving every item inside them to the trash.
   * @param ref - The folder to delete
   * @returns The number of items trashed
   */
  private *deleteFolderTree(ref: FolderRef): DbOp<number> {
    const currentDateTime = this.now();
    const allChildFolderIds = yield* this.getAllChildFolderIds(ref.Id, ref.ManifestId);

    let totalItemsDeleted = 0;

    // Move all items in this folder and in its child folders to trash
    for (const id of [ref.Id, ...allChildFolderIds]) {
      totalItemsDeleted += yield* this.execute(FolderQueries.TRASH_ITEMS_IN_FOLDER, [currentDateTime, currentDateTime, id, ref.ManifestId]);
    }

    // Soft delete all child folders, then the folder itself
    for (const id of [...allChildFolderIds, ref.Id]) {
      yield* this.execute(FolderQueries.SOFT_DELETE, [currentDateTime, id, ref.ManifestId]);
    }

    return totalItemsDeleted;
  }

  /**
   * Refuse to delete a folder that a shared manifest is rendered as (see {@link multiManifestRendering}).
   * @param ref - The folder about to be deleted
   */
  private async assertDeletable(ref: FolderRef): Promise<void> {
    const folder = await this.run(this.getById(ref));
    if (folder && multiManifestRendering.isManifestRoot(folder)) {
      throw new Error(await getPlatform().translate(TranslatableMessage.SharedFolderDeleteRefused));
    }
  }
}
