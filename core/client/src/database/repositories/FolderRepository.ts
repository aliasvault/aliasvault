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

      const parentId = parent ? multiManifestRendering.storedFolderId(parent.Id, parent.ManifestId) : null;
      await this.run(this.execute(FolderQueries.INSERT, [folderId, name, parentId, manifestId, currentDateTime, currentDateTime]));

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

  /**
   * Get all folders as the client presents them.
   * @returns The rendered folders
   */
  public *getAll(): DbOp<Folder[]> {
    return yield* this.renderedFolders();
  }

  /**
   * Get a folder by its manifest-qualified reference.
   * @param ref - The folder to read
   * @returns Folder object or null if not found
   */
  public *getById(ref: FolderRef): DbOp<Omit<Folder, 'Weight'> | null> {
    const folders = yield* this.renderedFolders();
    return folders.find(folder => folder.Id.toLowerCase() === ref.Id.toLowerCase() && folder.ManifestId.toLowerCase() === ref.ManifestId.toLowerCase()) ?? null;
  }

  /**
   * Update a folder's name.
   * @param ref - The folder to update
   * @param name - The new name for the folder
   * @returns The number of rows updated
   */
  public async update(ref: FolderRef, name: string): Promise<number> {
    this.assertNotVirtual(ref);
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
    this.assertNotVirtual(ref);
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
    const targetParentId = multiManifestRendering.storedFolderId(folder?.ParentFolderId, ref.ManifestId);

    // Move only items in this folder to the parent folder (or root if no parent)
    if (targetParentId) {
      // Has parent: move items to the parent folder, which a folder tree keeps in the same manifest
      yield* this.execute(FolderQueries.MOVE_ITEMS_TO_FOLDER, [targetParentId, currentDateTime, ref.Id, ref.ManifestId]);
    } else {
      // No parent: move items to the top level (NULL) of the manifest the folder lives in.
      yield* this.execute(FolderQueries.CLEAR_ITEMS_FOLDER, [currentDateTime, ref.Id, ref.ManifestId]);
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
    this.assertNotVirtual(ref);
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
   * Move a folder's contents into a shared manifest, whose top level its own items and subfolders land in. A folder row
   * cannot change manifest, so the subfolders are created there anew; items move with their own rows. The folder and its
   * subfolders are then deleted here.
   * @param ref - The folder whose contents move
   * @param targetManifestId - The shared manifest they move into
   * @returns The number of items moved
   */
  public async moveContentsToManifest(ref: FolderRef, targetManifestId: string): Promise<number> {
    this.assertNotVirtual(ref);
    return this.withTransaction(() => this.run(this.moveTree({ manifestId: ref.ManifestId, folderId: ref.Id }, { manifestId: targetManifestId, folderId: null })));
  }

  /**
   * Move everything a shared manifest holds into a new top-level personal folder with the given name, so the shared
   * manifest is left empty. Its folders are created there anew; items move with their own rows.
   * @param sourceManifestId - The shared manifest whose contents move
   * @param name - The name of the personal folder they move into
   * @returns The new personal folder
   */
  public async moveManifestToNewFolder(sourceManifestId: string, name: string): Promise<FolderRef> {
    return this.withTransaction(async () => {
      const manifestId = await this.run(this.writeManifestId());
      const folderId = crypto.randomUUID();
      const now = this.now();
      await this.run(this.execute(FolderQueries.INSERT, [folderId, name, null, manifestId, now, now]));
      await this.run(this.moveTree({ manifestId: sourceManifestId, folderId: null }, { manifestId, folderId }));
      return { Id: folderId, ManifestId: manifestId };
    });
  }

  /**
   * Recreate the folders under a source (a folder, or a manifest's top level) under a target in another manifest, move the
   * items along, and delete the source folders (the source folder itself included).
   * @param source - Where the contents are now: a folder, or the top level of a manifest when `folderId` is null
   * @param target - Where they land: a folder, or the top level of a manifest when `folderId` is null
   * @returns The number of items moved
   */
  private *moveTree(source: { manifestId: string; folderId: string | null }, target: { manifestId: string; folderId: string | null }): DbOp<number> {
    const now = this.now();
    // Source folder id (null for the source's top level) to the folder its contents land in.
    const landing = new Map<string | null, string | null>([[source.folderId, target.folderId]]);
    const pending: (string | null)[] = [source.folderId];
    const moved: string[] = [];

    while (pending.length > 0) {
      const parentId = pending.shift()!;
      const children = parentId === null
        ? yield* this.query<{ Id: string; Name: string }>(FolderQueries.GET_TOP_LEVEL_FOLDERS, [source.manifestId])
        : yield* this.query<{ Id: string; Name: string }>(FolderQueries.GET_CHILD_FOLDERS, [parentId, source.manifestId]);
      for (const child of children) {
        const newId = crypto.randomUUID();
        yield* this.execute(FolderQueries.INSERT, [newId, child.Name, landing.get(parentId) ?? null, target.manifestId, now, now]);
        landing.set(child.Id, newId);
        pending.push(child.Id);
        moved.push(child.Id);
      }
    }

    let itemsMoved = 0;
    for (const [folderId, newFolderId] of landing) {
      const items = folderId === null
        ? yield* this.query<{ Id: string }>(FolderQueries.GET_TOP_LEVEL_ITEM_IDS, [source.manifestId])
        : yield* this.query<{ Id: string }>(FolderQueries.GET_ITEM_IDS_IN_FOLDER, [folderId, source.manifestId]);
      for (const item of items) {
        itemsMoved += yield* this.execute(FolderQueries.MOVE_ITEM_TO_MANIFEST, [newFolderId, target.manifestId, now, item.Id, source.manifestId]);
      }
    }

    for (const id of [...moved.reverse(), ...(source.folderId ? [source.folderId] : [])]) {
      yield* this.execute(FolderQueries.SOFT_DELETE, [now, id, source.manifestId]);
    }

    return itemsMoved;
  }

  /**
   * Refuse to change or delete a virtual folder (see {@link multiManifestRendering}): the vault stores no row for
   * one, settings are managed elsewhere (e.g. shared manifest settings).
   * @param ref - The folder about to be changed
   */
  private assertNotVirtual(ref: FolderRef): void {
    if (multiManifestRendering.isVirtualFolder(ref)) {
      throw new Error(`FolderRepository: folder ${ref.Id} is virtual and cannot be changed or deleted; refusing the write.`);
    }
  }
}
