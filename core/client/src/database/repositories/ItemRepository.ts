import { FieldKey, LogoKinds, MAX_FIELD_HISTORY_RECORDS, getSystemField, normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod } from '@aliasvault/models/vault';

import { getFolderPath } from '../../items/FolderUtils';
import { selectFaviconTarget, toUrlList } from '../../rust/RustCore';
import { multiManifestRendering } from '../../sharing/MultiManifestRendering';
import { BaseRepository, type IDatabaseClient, type SqliteBindValue } from '../BaseRepository';
import { itemKeyBindings, scopedKey, type ItemRef } from '../ItemRef';
import { FieldMapper, type FieldRow } from '../mappers/FieldMapper';
import { ItemMapper, type ItemRow, type ItemSummary, type ItemSummaryRow, type TagRow, type ItemWithArchivedAt, type ItemWithDeletedAt } from '../mappers/ItemMapper';
import { FolderQueries } from '../queries/FolderQueries';
import {
  ItemQueries,
  FieldValueQueries,
  FieldDefinitionQueries,
  FieldHistoryQueries,
  TotpCodeQueries,
  AttachmentQueries
} from '../queries/ItemQueries';

import type { DbOp } from '../DbOp';
import type { Folder, FolderRef } from './FolderRepository';
import type { LogoRepository } from './LogoRepository';
import type { Item, ItemField, Attachment, TotpCode, FieldHistory, LogoSelection } from '@aliasvault/models/vault';

/**
 * A stored FieldValues row as the write path reads it, tombstones included.
 */
type StoredFieldValue = {
  Id: string;
  FieldKey: string | null;
  FieldDefinitionId: string | null;
  Value: string;
  Weight: number;
  ValueIndex: number;
  IsDeleted: number;
};

/**
 * Repository for Item CRUD operations.
 * Handles items, field values, field definitions, and field history.
 */
export class ItemRepository extends BaseRepository {
  /**
   * Constructor for the ItemRepository class.
   * @param client - The database client to use for the repository
   * @param logoRepository - The logo repository to use for the repository
   */
  public constructor(
    client: IDatabaseClient,
    private logoRepository: LogoRepository
  ) {
    super(client);
  }

  /**
   * Build folder paths for all folders using the shared utility.
   *
   * Keyed by the folder's scoped key rather than its id: folders are keyed by (ManifestId, Id), and a
   * shared manifest may hold a folder whose Id matches one of the user's own. The tree is walked per
   * manifest for the same reason: a parent link only ever resolves inside its own namespace.
   * @returns Map of scoped folder key to path array
   */
  private *buildFolderPaths(): DbOp<Map<string, string[]>> {
    const folderPathMap = new Map<string, string[]>();

    // The rendered folders, so a path starts at whatever a shared manifest is presented as.
    const folders = yield* this.renderedFolders();

    // Use shared utility to build paths, one manifest's tree at a time
    const foldersByManifest = new Map<string, Folder[]>();
    for (const folder of folders) {
      const key = folder.ManifestId.toLowerCase();
      const siblings = foldersByManifest.get(key) ?? [];
      siblings.push(folder);
      foldersByManifest.set(key, siblings);
    }

    for (const [manifestId, manifestFolders] of foldersByManifest) {
      for (const folder of manifestFolders) {
        const path = getFolderPath(folder, manifestFolders);
        if (path.length > 0) {
          folderPathMap.set(scopedKey(manifestId, folder.Id), path);
        }
      }
    }

    return folderPathMap;
  }

  /**
   * Fetch all active items with their dynamic fields and tags. Archived and trashed items are
   * excluded; this is what both the main item list and autofill read.
   * @returns Array of Item objects (empty array if Items table doesn't exist yet)
   */
  public *getAll(): DbOp<Item[]> {
    const itemRows = yield* this.selectItemRows(ItemQueries.GET_ALL_ACTIVE);
    return yield* this.hydrateItems(itemRows);
  }

  /**
   * Fetch the active items of one manifest with their dynamic fields and tags.
   * @param manifestId - The manifest to read
   * @returns Array of Item objects
   */
  public *getAllInManifest(manifestId: string): DbOp<Item[]> {
    const itemRows = yield* this.selectItemRows(ItemQueries.GET_ALL_ACTIVE_IN_MANIFEST, [manifestId]);
    return yield* this.hydrateItems(itemRows);
  }

  /**
   * Fetch the active items of one folder with their dynamic fields and tags.
   * @param folder - The folder to read
   * @returns Array of Item objects (empty array if the folder does not exist)
   */
  public *getByFolder(folder: FolderRef): DbOp<Item[]> {
    const storedFolderId = multiManifestRendering.storedFolderId(folder.Id, folder.ManifestId);
    const itemRows = storedFolderId
      ? yield* this.selectItemRows(ItemQueries.GET_BY_FOLDER, [storedFolderId, folder.ManifestId])
      : yield* this.selectItemRows(ItemQueries.GET_AT_MANIFEST_TOP_LEVEL, [folder.ManifestId]);
    return yield* this.hydrateItems(itemRows);
  }

  /**
   * Fetch every active item as the folder counts need it, without logos, fields or tags.
   * @returns Array of ItemSummary objects (empty array if Items table doesn't exist yet)
   */
  public *getAllSummaries(): DbOp<ItemSummary[]> {
    try {
      const rows = yield* this.query<ItemSummaryRow>(ItemQueries.GET_ALL_SUMMARIES);
      return ItemMapper.mapSummaryRows(yield* this.renderFolderIds(rows));
    } catch (error) {
      // Items table may not exist in older vault versions - return empty array
      if (error instanceof Error && error.message.includes('no such table')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Fetch all archived items with their dynamic fields and tags.
   * @returns Array of archived Item objects with ArchivedAt (empty array if Items table doesn't exist yet)
   */
  public *getArchived(): DbOp<ItemWithArchivedAt[]> {
    const itemRows = yield* this.selectItemRows(ItemQueries.GET_ARCHIVED);
    const items = yield* this.hydrateItems(itemRows);
    return items.map((item, index) => ({ ...item, ArchivedAt: itemRows[index].ArchivedAt ?? undefined }));
  }

  /**
   * Get count of archived items.
   * @returns Number of archived items
   */
  public *getArchivedCount(): DbOp<number> {
    try {
      const result = yield* this.query<{ count: number }>(ItemQueries.COUNT_ARCHIVED);
      return result[0]?.count ?? 0;
    } catch (error) {
      if (error instanceof Error && error.message.includes('no such table')) {
        return 0;
      }
      throw error;
    }
  }

  /**
   * Run an item SELECT, tolerating a vault whose schema predates the Items table.
   * @param query - The item query to run
   * @param params - The bound parameters
   * @returns The raw item rows, or an empty array if the table does not exist yet
   */
  private *selectItemRows(query: string, params: SqliteBindValue[] = []): DbOp<ItemRow[]> {
    try {
      return yield* this.renderFolderIds(yield* this.query<ItemRow>(query, params));
    } catch (error) {
      // Items table may not exist in older vault versions - return empty array
      if (error instanceof Error && error.message.includes('no such table')) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Attach fields, tags and folder paths to raw item rows.
   * @param itemRows - The raw item rows to hydrate
   * @returns The hydrated Item objects, in the order the rows came in
   */
  private *hydrateItems(itemRows: ItemRow[]): DbOp<Item[]> {
    if (itemRows.length === 0) {
      return [];
    }

    /*
     * Items are matched on their whole key, so a shared manifest's item cannot pick up the fields or
     * tags of a personal item that happens to share its Id.
     */
    const itemRefs = itemRows.map(row => ({ Id: row.Id, ManifestId: row.ManifestId }));

    // Get all field values
    const fieldRows = yield* this.query<FieldRow>(ItemQueries.getFieldValuesForItems(itemRefs.length), itemKeyBindings(itemRefs));
    const fieldsByItem = FieldMapper.processFieldRows(fieldRows);

    // Get all tags
    const tagRows = yield* this.query<TagRow>(ItemQueries.getTagsForItems(itemRefs.length), itemKeyBindings(itemRefs));
    const tagsByItem = ItemMapper.groupTagsByItem(tagRows);

    // Build folder paths
    const folderPaths = yield* this.buildFolderPaths();

    return ItemMapper.mapRows(itemRows, fieldsByItem, tagsByItem, folderPaths);
  }

  /**
   * Fetch a single item with its dynamic fields and tags.
   * @param ref - The item, named by its manifest and id
   * @returns Item object or null if not found
   */
  public *getById(ref: ItemRef): DbOp<Item | null> {

    const results = yield* this.renderFolderIds(yield* this.query<ItemRow>(ItemQueries.GET_BY_ID, [ref.Id, ref.ManifestId]));
    if (results.length === 0) {
      return null;
    }

    // Get field values
    const fieldRows = yield* this.query<Omit<FieldRow, 'ItemId' | 'ManifestId'>>(ItemQueries.GET_FIELD_VALUES_FOR_ITEM, [ref.Id, ref.ManifestId]);
    const fields = FieldMapper.processFieldRowsForSingleItem(fieldRows);

    // Get tags
    const tagRows = yield* this.query<Omit<TagRow, 'ItemId' | 'ManifestId'>>(ItemQueries.GET_TAGS_FOR_ITEM, [ref.Id, ref.ManifestId]);
    const tags = ItemMapper.mapTagRows(tagRows);

    // Get folder path if item is in a folder
    let folderPath: string[] | undefined;
    if (results[0].FolderId) {
      const folderPaths = yield* this.buildFolderPaths();
      folderPath = folderPaths.get(scopedKey(results[0].ManifestId, results[0].FolderId));
    }

    return ItemMapper.mapRow(results[0], fields, tags, folderPath);
  }

  /**
   * Fetch the unique email addresses the vault still routes mail to, i.e. every live login email field the user
   * has not switched off. A switched-off alias keeps its claim link and its stored mail server-side, but the
   * client stops asking for its mailbox until it is switched back on.
   * @returns Array of email addresses
   */
  public *getRoutableEmailAddresses(): DbOp<string[]> {
    const results = yield* this.query<{ Email: string }>(ItemQueries.GET_ROUTABLE_EMAIL_ADDRESSES, [FieldKey.LoginEmail]);
    return results.map(row => row.Email);
  }

  /**
   * Check whether the vault still routes mail to one address. False once every live item carrying it has the
   * alias switched off, or when no live item carries it at all.
   * @param email - The full email address (local@domain) to check
   * @returns True when at least one live, switched-on login email field carries this address
   */
  public *isEmailAddressRoutable(email: string): DbOp<boolean> {
    const results = yield* this.query<{ Count: number }>(ItemQueries.COUNT_ROUTABLE_EMAIL_FIELDS, [FieldKey.LoginEmail, email.trim().toLowerCase()]);
    return (results[0]?.Count ?? 0) > 0;
  }

  /**
   * Find the item (reference + name) associated with a given email address, if any.
   * @param email - The full email address (local@domain) to look up
   * @returns The item reference and name, or null when no active item uses this address
   */
  public *findIdByEmail(email: string): DbOp<(ItemRef & { Name: string | null }) | null> {
    const results = yield* this.query<ItemRef & { Name: string | null }>(ItemQueries.GET_ITEM_BY_EMAIL, [FieldKey.LoginEmail, email]);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Create a new item with field-based structure.
   * @param item The item object to insert
   * @param attachments Optional attachments to associate with the item
   * @param totpCodes Optional TOTP codes to associate with the item
   * @param logoSelection A logo the user picked or uploaded; omit to resolve the favicon from the URL
   * @returns The created item, named by its manifest and id
   */
  public async create(
    item: Item,
    attachments: Attachment[] = [],
    totpCodes: TotpCode[] = [],
    logoSelection?: LogoSelection
  ): Promise<ItemRef> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const itemId = item.Id || this.generateId();

      // 1. The item names its manifest; a folder it points at has to live in that same manifest.
      const manifestId = item.ManifestId;
      const folderId = multiManifestRendering.storedFolderId(item.FolderId, manifestId);
      await this.run(this.assertFolderInManifest(folderId, manifestId));

      // 2. Handle the logo
      const logoId = await this.resolveLogoId(item, manifestId, currentDateTime, null, logoSelection);

      // 3. Insert Item
      await this.run(this.execute(ItemQueries.INSERT_ITEM, [itemId, item.Name ?? null, item.ItemType, logoId, folderId, manifestId, currentDateTime, currentDateTime, 0]));

      /*
       * 4-6. Insert the child rows into the manifest the item was just written into.
       */
      if (item.Fields && item.Fields.length > 0) {
        await this.run(this.insertFieldValues(itemId, item.Fields, item.ItemType, manifestId, currentDateTime));
      }

      await this.run(this.insertTotpCodes(itemId, totpCodes, manifestId, currentDateTime));
      await this.run(this.insertAttachments(itemId, attachments, manifestId, currentDateTime));

      return { Id: itemId, ManifestId: manifestId };
    });
  }

  /**
   * Duplicate an item including all fields. Data that is not duplicated is passkeys and field history.
   * @param ref - The item, named by its manifest and id
   * @returns The newly created item, which lives in the same manifest
   */
  public async duplicate(ref: ItemRef): Promise<ItemRef> {
    return this.withTransaction(() => this.run(this.copyItem(ref)));
  }

  /**
   * Copy an item and its child rows under fresh ids.
   * @param ref - The item, named by its manifest and id
   * @returns The newly created item
   */
  private *copyItem(ref: ItemRef): DbOp<ItemRef> {
    const currentDateTime = this.now();
    const newItemId = this.generateId();

    const sourceRows = yield* this.query<{ Name: string | null }>('SELECT Name FROM Items WHERE Id = ? AND ManifestId = ? AND IsDeleted = 0', [ref.Id, ref.ManifestId]);
    if (sourceRows.length === 0) {
      throw new Error(`Item not found: ${ref.Id}`);
    }

    const existingNames = yield* this.query<{ Name: string | null }>('SELECT Name FROM Items WHERE IsDeleted = 0 AND DeletedAt IS NULL');
    const newName = ItemRepository.generateCopyName(sourceRows[0].Name, existingNames.map(row => row.Name));

    /*
     * 1. Copy the item row itself (same logo, folder and type).
     */
    yield* this.execute(`
      INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, ManifestId, CreatedAt, UpdatedAt, IsDeleted)
      SELECT ?, ?, ItemType, LogoId, FolderId, ManifestId, ?, ?, 0 FROM Items WHERE Id = ? AND ManifestId = ?`,
    [newItemId, newName, currentDateTime, currentDateTime, ref.Id, ref.ManifestId]);

    /*
     * 2. Copy custom field definitions so later edits to the duplicate's
     * custom fields don't affect the original item.
     */
    const definitionRows = yield* this.query<{ Id: string }>(
      `SELECT DISTINCT FieldDefinitionId as Id FROM FieldValues
       WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0 AND FieldDefinitionId IS NOT NULL`,
      [ref.Id, ref.ManifestId]
    );
    const definitionIdMap = new Map<string, string>();
    for (const definition of definitionRows) {
      const newDefinitionId = this.generateId();
      definitionIdMap.set(definition.Id, newDefinitionId);
      yield* this.execute(`
        INSERT INTO FieldDefinitions (Id, ManifestId, FieldType, Label, IsMultiValue, IsHidden, EnableHistory, Weight, ApplicableToTypes, CreatedAt, UpdatedAt, IsDeleted)
        SELECT ?, ManifestId, FieldType, Label, IsMultiValue, IsHidden, EnableHistory, Weight, ApplicableToTypes, ?, ?, 0
        FROM FieldDefinitions WHERE Id = ? AND ManifestId = ?`,
      [newDefinitionId, currentDateTime, currentDateTime, definition.Id, ref.ManifestId]);
    }

    // 3. Copy field values, remapping custom fields to the copied definitions.
    const fieldValueRows = yield* this.query<{ Id: string; FieldDefinitionId: string | null }>(
      'SELECT Id, FieldDefinitionId FROM FieldValues WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0',
      [ref.Id, ref.ManifestId]
    );
    for (const row of fieldValueRows) {
      yield* this.execute(`
        INSERT INTO FieldValues (Id, ItemId, ManifestId, FieldDefinitionId, FieldKey, Value, Weight, CreatedAt, UpdatedAt, IsDeleted)
        SELECT ?, ?, ManifestId, ?, FieldKey, Value, Weight, ?, ?, 0 FROM FieldValues WHERE Id = ? AND ManifestId = ?`,
      [
        this.generateId(),
        newItemId,
        row.FieldDefinitionId ? definitionIdMap.get(row.FieldDefinitionId) ?? null : null,
        currentDateTime,
        currentDateTime,
        row.Id,
        ref.ManifestId
      ]);
    }

    /*
     * 4. Copy remaining child rows with fresh IDs.
     */
    const childCopies = [
      {
        table: 'TotpCodes',
        sql: `INSERT INTO TotpCodes (Id, ItemId, ManifestId, Name, SecretKey, Algorithm, Digits, Period, CreatedAt, UpdatedAt, IsDeleted)
              SELECT ?, ?, ManifestId, Name, SecretKey, Algorithm, Digits, Period, ?, ?, 0 FROM TotpCodes WHERE Id = ? AND ManifestId = ?`,
      },
      {
        table: 'Attachments',
        sql: `INSERT INTO Attachments (Id, ItemId, ManifestId, Filename, Blob, BlobHash, CreatedAt, UpdatedAt, IsDeleted)
              SELECT ?, ?, ManifestId, Filename, Blob, BlobHash, ?, ?, 0 FROM Attachments WHERE Id = ? AND ManifestId = ?`,
      },
    ];

    for (const copy of childCopies) {
      const rows = yield* this.query<{ Id: string }>(`SELECT Id FROM ${copy.table} WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0`, [ref.Id, ref.ManifestId]);
      for (const row of rows) {
        yield* this.execute(copy.sql, [this.generateId(), newItemId, currentDateTime, currentDateTime, row.Id, ref.ManifestId]);
      }
    }

    // ItemTags has no Id of its own: a row is the (item, tag) pair, so the tags copy in one statement.
    yield* this.execute(`
      INSERT INTO ItemTags (ManifestId, ItemId, TagId, CreatedAt, UpdatedAt, IsDeleted)
      SELECT ManifestId, ?, TagId, ?, ?, 0 FROM ItemTags WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0`,
    [newItemId, currentDateTime, currentDateTime, ref.Id, ref.ManifestId]);

    return { Id: newItemId, ManifestId: ref.ManifestId };
  }

  /**
   * Generate a unique name for a duplicated item: "Name (1)", "Name (2)", etc.
   * If the source name already ends with a "(n)" suffix, the counter is incremented
   * instead of stacking suffixes.
   */
  private static generateCopyName(sourceName: string | null, existingNames: (string | null)[]): string | null {
    if (!sourceName) {
      return sourceName;
    }

    const base = sourceName.replace(/ \(\d+\)$/, '');
    const taken = new Set(existingNames.filter((name): name is string => name !== null));

    let candidate = `${base} (1)`;
    for (let counter = 2; taken.has(candidate); counter++) {
      candidate = `${base} (${counter})`;
    }
    return candidate;
  }

  /**
   * Update an existing item with field-based structure.
   * @param ref Where the item is now; `item.ManifestId` names where it belongs, which differs when it changed folder
   * @param item The item object to update
   * @param originalAttachmentIds Original attachment IDs for tracking changes
   * @param attachments Current attachments list
   * @param originalTotpCodeIds Original TOTP code IDs for tracking changes
   * @param totpCodes Current TOTP codes list
   * @param logoSelection A logo the user picked or uploaded; omit to leave the current logo logic alone
   * @returns Where the item is after the write (a folder change may move it to another manifest), or null when it does not exist
   */
  public async update(
    ref: ItemRef,
    item: Item,
    originalAttachmentIds: string[] = [],
    attachments: Attachment[] = [],
    originalTotpCodeIds: string[] = [],
    totpCodes: TotpCode[] = [],
    logoSelection?: LogoSelection
  ): Promise<ItemRef | null> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      if (item.Id !== ref.Id) {
        throw new Error('ItemRepository: the item to update does not carry the id of the row it replaces.');
      }

      // 1. Read the stored item first: resolving the logo needs to know which one it already has.
      const existing = (await this.run(this.query<{
        Name: string | null;
        ItemType: number;
        FolderId: string | null;
        LogoId: string | null;
      }>(ItemQueries.GET_ITEM_FIELDS, [ref.Id, ref.ManifestId])))[0];
      if (!existing) {
        return null;
      }

      // 2. The manifest the item ends up in, then the logo inside it.
      const manifestId = item.ManifestId;
      const folderId = multiManifestRendering.storedFolderId(item.FolderId, manifestId);
      await this.run(this.assertFolderInManifest(folderId, manifestId));
      const logoId = await this.resolveLogoId(item, manifestId, currentDateTime, existing.LogoId, logoSelection, ref.ManifestId);

      const nameChanged = (item.Name ?? null) !== existing.Name;
      const itemTypeChanged = String(item.ItemType) !== String(existing.ItemType);
      const folderChanged = folderId !== existing.FolderId || manifestId !== ref.ManifestId;
      const logoIdChanged = logoId !== existing.LogoId;

      if (nameChanged || itemTypeChanged || folderChanged || logoIdChanged) {
        // A move across manifests re-stamps the item; the schema trigger takes its child rows along.
        await this.run(this.execute(ItemQueries.UPDATE_ITEM_WITH_LOGO, [item.Name ?? null, item.ItemType, folderId, manifestId, logoId, currentDateTime, ref.Id, ref.ManifestId]));
      }

      // 3. Track history for fields that have EnableHistory=true before updating
      await this.run(this.trackFieldHistory(ref.Id, manifestId, item.Fields, currentDateTime));

      // 4. Update field values
      await this.run(this.updateFieldValues(item, manifestId, currentDateTime));

      // 5. Handle TOTP codes
      await this.run(this.handleTotpCodes(ref.Id, manifestId, totpCodes, originalTotpCodeIds, currentDateTime));

      // 6. Handle attachments
      await this.run(this.handleAttachments(ref.Id, manifestId, attachments, originalAttachmentIds, currentDateTime));

      return { Id: ref.Id, ManifestId: manifestId };
    });
  }

  /**
   * Move an item to "Recently Deleted" (trash).
   * @param ref - The item, named by its manifest and id
   * @returns The number of rows updated
   */
  public async trash(ref: ItemRef): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.run(this.execute(ItemQueries.TRASH_ITEM, [currentDateTime, currentDateTime, ref.Id, ref.ManifestId]));
    });
  }

  /**
   * Restore an item from "Recently Deleted".
   * @param ref - The item, named by its manifest and id
   * @returns The number of rows updated
   */
  public async restore(ref: ItemRef): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.run(this.execute(ItemQueries.RESTORE_ITEM, [currentDateTime, ref.Id, ref.ManifestId]));
    });
  }

  /**
   * Archive an item: it disappears from the main list and from autofill, but keeps all of its data
   * and its email aliases, and is never auto-pruned.
   * @param ref - The item, named by its manifest and id
   * @returns The number of rows updated
   */
  public async archive(ref: ItemRef): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.run(this.execute(ItemQueries.ARCHIVE_ITEM, [currentDateTime, currentDateTime, ref.Id, ref.ManifestId]));
    });
  }

  /**
   * Unarchive an item, returning it to the main list and to autofill.
   * @param ref - The item, named by its manifest and id
   * @returns The number of rows updated
   */
  public async unarchive(ref: ItemRef): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.run(this.execute(ItemQueries.UNARCHIVE_ITEM, [currentDateTime, ref.Id, ref.ManifestId]));
    });
  }

  /**
   * Permanently delete an item - converts to tombstone for sync.
   * @param ref - The item, named by its manifest and id
   * @returns The number of rows updated
   */
  public async permanentlyDelete(ref: ItemRef): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();

      // Hard delete all related entities within this item's manifest.
      for (const table of ['FieldValues', 'FieldHistories', 'Passkeys', 'TotpCodes', 'Attachments', 'ItemTags']) {
        await this.run(this.hardDeleteByScopedForeignKey(table, 'ItemId', ref.Id, ref.ManifestId));
      }

      // Convert item to tombstone.
      return this.run(this.execute(ItemQueries.TOMBSTONE_ITEM, [currentDateTime, ref.Id, ref.ManifestId]));
    });
  }

  /**
   * Get all items in "Recently Deleted".
   * @returns Array of trashed Item objects with DeletedAt
   */
  public *getRecentlyDeleted(): DbOp<ItemWithDeletedAt[]> {
    let itemRows: (ItemRow & { DeletedAt: string })[];
    try {
      const query = `
        SELECT
          i.Id,
          i.ManifestId,
          i.Name,
          i.ItemType,
          i.FolderId,
          l.FileData as Logo,
          i.DeletedAt,
          CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.ManifestId = i.ManifestId AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
          CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.ManifestId = i.ManifestId AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
          CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.ManifestId = i.ManifestId AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
          i.CreatedAt,
          i.UpdatedAt
        FROM Items i
        LEFT JOIN Logos l ON i.LogoId = l.Id AND l.ManifestId = i.ManifestId
        WHERE i.IsDeleted = 0 AND i.DeletedAt IS NOT NULL
        ORDER BY i.DeletedAt DESC`;

      itemRows = yield* this.renderFolderIds(yield* this.query<ItemRow & { DeletedAt: string }>(query));
    } catch (error) {
      if (error instanceof Error && error.message.includes('no such table')) {
        return [];
      }
      throw error;
    }

    if (itemRows.length === 0) {
      return [];
    }

    const itemRefs = itemRows.map(row => ({ Id: row.Id, ManifestId: row.ManifestId }));

    // Get all field values
    const fieldRows = yield* this.query<FieldRow>(ItemQueries.getFieldValuesForItems(itemRefs.length), itemKeyBindings(itemRefs));
    const fieldsByItem = FieldMapper.processFieldRows(fieldRows);

    // Build folder paths
    const folderPaths = yield* this.buildFolderPaths();

    return itemRows.map(row => ItemMapper.mapDeletedItemRow(
      row,
      fieldsByItem.get(scopedKey(row.ManifestId, row.Id)) || [],
      row.FolderId ? folderPaths.get(scopedKey(row.ManifestId, row.FolderId)) : undefined
    ));
  }

  /**
   * Get count of items in "Recently Deleted".
   * @returns Number of trashed items
   */
  public *getRecentlyDeletedCount(): DbOp<number> {
    try {
      const result = yield* this.query<{ count: number }>(ItemQueries.COUNT_RECENTLY_DELETED);
      return result[0]?.count || 0;
    } catch (error) {
      if (error instanceof Error && error.message.includes('no such table')) {
        return 0;
      }
      throw error;
    }
  }

  /**
   * Get an item's TOTP codes.
   * @param ref - The item, named by its manifest and id
   * @returns Array of TotpCode objects
   */
  public *getTotpCodesForItem(ref: ItemRef): DbOp<TotpCode[]> {
    return yield* this.query<TotpCode>(TotpCodeQueries.GET_BY_ITEM_ID, [ref.Id, ref.ManifestId]);
  }

  /**
   * Get an item's attachments.
   * @param ref - The item, named by its manifest and id
   * @returns Array of attachments for the item
   */
  public *getAttachmentsForItem(ref: ItemRef): DbOp<Attachment[]> {
    return yield* this.query<Attachment>(AttachmentQueries.GET_BY_ITEM_ID, [ref.Id, ref.ManifestId]);
  }

  /**
   * Get field history for a specific field.
   * @param ref - The item, named by its manifest and id
   * @param fieldKey - The field key to get history for
   * @returns Array of field history records
   */
  public *getFieldHistory(ref: ItemRef, fieldKey: string): DbOp<FieldHistory[]> {

    const results = yield* this.query<{
      Id: string;
      ItemId: string;
      FieldKey: string;
      ValueSnapshot: string;
      ChangedAt: string;
      CreatedAt: string;
      UpdatedAt: string;
    }>(FieldHistoryQueries.GET_FOR_FIELD, [ref.Id, ref.ManifestId, fieldKey, MAX_FIELD_HISTORY_RECORDS]);

    return results.map(row => ({
      Id: row.Id,
      ItemId: row.ItemId,
      FieldKey: row.FieldKey,
      ValueSnapshot: row.ValueSnapshot,
      ChangedAt: row.ChangedAt,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt
    }));
  }

  /**
   * Delete a specific field history record.
   * @param historyId - The ID of the history record to delete
   * @param manifestId - The manifest the record belongs to, which is its item's
   * @returns Number of rows affected
   */
  public async deleteFieldHistory(historyId: string, manifestId: string): Promise<number> {
    return this.withTransaction(() => this.run(this.execute(FieldHistoryQueries.SOFT_DELETE, [this.now(), historyId, manifestId])));
  }

  /**
   * Refuse a folder that is not in the item's manifest. A folder id can exist in several manifests, so the item's
   * own manifest is what determines explicitly which folder is targeted.
   * @param folderId The folder the item is stored in, null for the top level of its manifest
   * @param manifestId The manifest the item is written into
   */
  private *assertFolderInManifest(folderId: string | null, manifestId: string): DbOp<void> {
    if (!folderId) {
      return;
    }

    const rows = yield* this.query<{ Found: number }>(FolderQueries.EXISTS, [folderId, manifestId]);
    if (rows.length === 0) {
      throw new Error(`ItemRepository: folder ${folderId} does not exist in manifest ${manifestId}; refusing the write.`);
    }
  }

  /**
   * Resolve which logo row an item points at.
   *
   * The rules, in order:
   *   1. an explicit selection wins: the user picked a built-in logo, uploaded an image, or asked to
   *      go back to the automatic favicon;
   *   2. otherwise a logo the user chose earlier (built-in or uploaded) is kept, so editing the URL
   *      never silently replaces a deliberate choice with a favicon;
   *   3. a favicon selection carrying bytes is a re-fetch of the current domain, which refreshes the
   *      image the domain's row holds;
   *
   * @param item The item being created or updated
   * @param scope The manifest the item is written into, which the logo row has to live in too
   * @param currentDateTime The current date/time string for timestamps
   * @param existingLogoId The favicon the item currently has, when updating
   * @param selection A favicon the user explicitly picked or uploaded
   * @param storedManifestId The manifest the stored item is in, where its current logo row lives
   * @returns The favicon ID to store on the item, or null when it should have none
   */
  private async resolveLogoId(
    item: Item,
    scope: string,
    currentDateTime: string,
    existingLogoId: string | null = null,
    selection?: LogoSelection,
    storedManifestId: string = scope
  ): Promise<string | null> {
    if (selection && selection.Kind !== LogoKinds.Favicon) {
      return this.resolveSelectedLogo(selection, scope, currentDateTime);
    }

    const existing = existingLogoId ? await this.run(this.logoRepository.getById(existingLogoId, storedManifestId)) : null;
    if (!selection && existing && existing.Kind !== LogoKinds.Favicon) {
      return this.logoRepository.ensureInScope(scope, existing.Kind, existing.Source, currentDateTime);
    }

    const urlField = item.Fields?.find(f => f.FieldKey === 'login.url');
    // The first URL a domain can be read from, which is the one the favicon was fetched for.
    const target = await selectFaviconTarget(toUrlList(urlField?.Value));

    /*
     * Without a domain there is no natural key to store a favicon under: every item with an
     * unparseable URL would end up sharing (and overwriting) the same row.
     */
    if (!target) {
      return null;
    }

    const source = target.source;

    /*
     * An explicit re-fetch: the user asked for this domain's favicon to be pulled again because the one
     * on file went stale, so the fresh bytes replace it.
     */
    const refetched = selection?.Kind === LogoKinds.Favicon && selection.Data ? this.logoRepository.convertToUint8Array(selection.Data) : null;
    if (refetched && refetched.length > 0) {
      return this.logoRepository.getOrCreate(scope, LogoKinds.Favicon, source, refetched, currentDateTime, { mimeType: 'image/x-icon' });
    }

    // Keep the current favicon when it is already this domain's, whatever scope it lives in.
    if (existing && existing.Kind === LogoKinds.Favicon && existing.Source === source) {
      return this.logoRepository.ensureInScope(scope, LogoKinds.Favicon, source, currentDateTime);
    }

    /*
     * Fresh image bytes for this domain: callers only attach Logo after fetching the favicon for the
     * URL the item now has, so these belong under this Source. Bytes left over from a previous URL
     * must never reach here, see FaviconService.fetchAndAttachFavicon.
     */
    const faviconData = item.Logo ? this.logoRepository.convertToUint8Array(item.Logo) : null;
    if (faviconData && faviconData.length > 0) {
      return this.logoRepository.getOrCreate(scope, LogoKinds.Favicon, source, faviconData, currentDateTime, { mimeType: 'image/x-icon' });
    }

    /*
     * Otherwise reuse the favicon this domain already has, or none at all. Falling back to the item's
     * previous logo here is what made an item keep the old site's logo after its URL was changed.
     */
    return this.logoRepository.ensureInScope(scope, LogoKinds.Favicon, source, currentDateTime);
  }

  /**
   * Resolve a logo the user explicitly picked: a catalog key, an image they just uploaded, or one
   * already in their library.
   * @param selection The user's choice
   * @param scope The manifest the item is being written into, which the logo has to live in too
   * @param currentDateTime The current date/time string for timestamps
   * @returns The logo ID, or null when the selection carries nothing to resolve
   */
  private async resolveSelectedLogo(selection: LogoSelection, scope: string, currentDateTime: string): Promise<string | null> {
    if (selection.Kind === LogoKinds.Builtin) {
      // Built-in logos carry no bytes: every platform draws them from the shared catalog.
      return selection.Source ? this.logoRepository.getOrCreate(scope, LogoKinds.Builtin, selection.Source, null, currentDateTime) : null;
    }

    const uploaded = selection.Data ? this.logoRepository.convertToUint8Array(selection.Data) : null;
    if (uploaded && uploaded.length > 0) {
      return this.logoRepository.storeUpload(scope, uploaded, currentDateTime, { mimeType: selection.MimeType ?? 'image/png', name: selection.Name });
    }

    /*
     * No new bytes: the user picked an image from their library, addressed by its hash.
     */
    return selection.Source ? this.logoRepository.ensureInScope(scope, LogoKinds.Custom, selection.Source, currentDateTime) : null;
  }

  /**
   * Insert field values for a new item.
   * Also creates history records for fields with EnableHistory=true.
   */
  private *insertFieldValues(
    itemId: string,
    fields: ItemField[],
    itemType: string,
    manifestId: string,
    currentDateTime: string
  ): DbOp<void> {
    for (const field of fields) {
      // Skip empty system fields, but always persist custom fields (even if empty)
      const isEmpty = !field.Value || (typeof field.Value === 'string' && field.Value.trim() === '');
      if (isEmpty && !field.IsCustomField) {
        continue;
      }

      let fieldDefinitionId = null;

      // For custom fields, create or get FieldDefinition
      if (field.IsCustomField) {
        fieldDefinitionId = yield* this.upsertFieldDefinition(field, itemType, manifestId, currentDateTime);
      }

      // Handle multi-value fields
      const values = Array.isArray(field.Value) ? field.Value : [field.Value];
      const filteredValues = values.filter(v => v && v.trim() !== '');

      // For custom fields with no values, insert with empty string to preserve the field
      const valuesToInsert = field.IsCustomField && filteredValues.length === 0
        ? ['']
        : filteredValues;

      for (const [valueIndex, value] of valuesToInsert.entries()) {
        yield* this.execute(FieldValueQueries.INSERT, [
          this.generateId(),
          itemId,
          manifestId,
          fieldDefinitionId,
          field.IsCustomField ? null : field.FieldKey,
          value,
          field.DisplayOrder ?? 0,
          valueIndex,
          currentDateTime,
          currentDateTime,
          0
        ]);
      }

      // Create history record for fields with EnableHistory=true
      if (field.EnableHistory && filteredValues.length > 0) {
        yield* this.execute(FieldHistoryQueries.INSERT, [
          this.generateId(),
          itemId,
          manifestId,
          null,
          field.FieldKey,
          JSON.stringify(filteredValues),
          currentDateTime,
          currentDateTime,
          currentDateTime,
          0
        ]);
      }
    }
  }

  /**
   * Update field values for an existing item.
   */
  private *updateFieldValues(item: Item, manifestId: string, currentDateTime: string): DbOp<void> {
    const storedRows = yield* this.query<StoredFieldValue>(FieldValueQueries.GET_ALL_FOR_ITEM, [item.Id, manifestId]);

    const rowsByField = new Map<string, StoredFieldValue[]>();
    for (const row of storedRows) {
      const key = (row.FieldKey || row.FieldDefinitionId || '').toLowerCase();
      rowsByField.set(key, [...(rowsByField.get(key) ?? []), row]);
    }

    const keptIds = new Set<string>();

    for (const field of item.Fields ?? []) {
      // Skip empty system fields, but always persist custom fields (even if empty)
      const isEmpty = !field.Value || (typeof field.Value === 'string' && field.Value.trim() === '');
      if (isEmpty && !field.IsCustomField) {
        continue;
      }

      let fieldDefinitionId = null;

      if (field.IsCustomField) {
        fieldDefinitionId = yield* this.upsertFieldDefinition(field, item.ItemType, manifestId, currentDateTime);
      }

      const values = Array.isArray(field.Value) ? field.Value : [field.Value];

      // For custom fields with no values, use empty string to preserve the field
      const filteredValues = values.filter(v => v && (typeof v !== 'string' || v.trim() !== ''));
      const valuesToProcess = field.IsCustomField && filteredValues.length === 0
        ? ['']
        : filteredValues;

      const isMultiValue = !field.IsCustomField && (getSystemField(field.FieldKey)?.IsMultiValue ?? false);
      const rows = ItemRepository.assignFieldValueRows(valuesToProcess, rowsByField.get(field.FieldKey.toLowerCase()) ?? [], isMultiValue);
      const weight = field.DisplayOrder ?? 0;

      for (const [valueIndex, value] of valuesToProcess.entries()) {
        const row = rows[valueIndex];
        if (!row) {
          yield* this.execute(FieldValueQueries.INSERT, [
            this.generateId(),
            item.Id,
            manifestId,
            fieldDefinitionId,
            field.IsCustomField ? null : field.FieldKey,
            value,
            weight,
            valueIndex,
            currentDateTime,
            currentDateTime,
            0
          ]);
          continue;
        }

        keptIds.add(row.Id);
        if (row.IsDeleted || row.Value !== value || row.Weight !== weight || row.ValueIndex !== valueIndex) {
          yield* this.execute(FieldValueQueries.UPDATE, [value, weight, valueIndex, currentDateTime, row.Id, manifestId]);
        }
      }
    }

    // Soft-delete every live row no value was kept on
    for (const row of storedRows) {
      if (!row.IsDeleted && !keptIds.has(row.Id)) {
        yield* this.execute(FieldValueQueries.SOFT_DELETE, [currentDateTime, row.Id, manifestId]);
      }
    }
  }

  /**
   * Decide which stored row each value of one field is written to, `undefined` meaning a new row.
   * @param values - The field's values, in display order
   * @param fieldRows - The field's stored rows, tombstones included
   * @param isMultiValue - Whether the field holds several values, each owning its row
   * @returns One entry per value
   */
  private static assignFieldValueRows(values: string[], fieldRows: StoredFieldValue[], isMultiValue: boolean): (StoredFieldValue | undefined)[] {
    const assigned: (StoredFieldValue | undefined)[] = values.map(() => undefined);
    const free = new Set(fieldRows);

    /**
     * Give every still unassigned value the first free row that qualifies for it.
     */
    const assign = (qualifies: (row: StoredFieldValue, value: string) => boolean): void => {
      for (const [index, value] of values.entries()) {
        const row = assigned[index] ? undefined : [...free].find(candidate => qualifies(candidate, value));
        if (row) {
          assigned[index] = row;
          free.delete(row);
        }
      }
    };

    // 1. An unchanged value stays on its row.
    assign((row, value) => !row.IsDeleted && row.Value === value);
    // 2. An edited value keeps a row that is still live.
    assign(row => !row.IsDeleted);
    // 3. A removed value that returns gets its row back. A single-value field has one row, whatever it held.
    assign((row, value) => Boolean(row.IsDeleted) && (!isMultiValue || row.Value === value));

    return assigned;
  }

  /**
   * Insert or update the field definition of a custom field; a soft-deleted definition is revived.
   */
  private *upsertFieldDefinition(field: ItemField, itemType: string, manifestId: string, currentDateTime: string): DbOp<string> {
    const existingDef = yield* this.query<{ Id: string }>(FieldDefinitionQueries.EXISTS, [field.FieldKey, manifestId]);

    if (existingDef.length === 0) {
      yield* this.execute(FieldDefinitionQueries.INSERT, [
        field.FieldKey,
        manifestId,
        field.FieldType,
        field.Label,
        0, // IsMultiValue
        field.IsHidden ? 1 : 0,
        0, // EnableHistory
        field.DisplayOrder ?? 0,
        itemType,
        currentDateTime,
        currentDateTime,
        0
      ]);
    } else {
      yield* this.execute(FieldDefinitionQueries.UPDATE, [
        field.Label,
        field.FieldType,
        field.IsHidden ? 1 : 0,
        field.DisplayOrder ?? 0,
        currentDateTime,
        field.FieldKey,
        manifestId
      ]);
    }

    return field.FieldKey;
  }

  /**
   * Track field history for fields with EnableHistory=true.
   *
   * This saves the NEW value to history on every change. Since each value is saved
   * when it's set, we don't need to save the old value (it was already saved when
   * it was first set). This ensures that during merge conflicts, no values are ever
   * lost since history records sync independently via LWW and each has a unique ID.
   */
  private *trackFieldHistory(
    itemId: string,
    manifestId: string,
    newFields: ItemField[],
    currentDateTime: string
  ): DbOp<void> {
    const existingFields = yield* this.query<{ FieldKey: string; Value: string }>(FieldValueQueries.GET_FOR_HISTORY, [itemId, manifestId]);

    // Create a map of existing values by FieldKey
    const existingValuesMap: { [key: string]: string[] } = {};
    for (const field of existingFields) {
      if (!existingValuesMap[field.FieldKey]) {
        existingValuesMap[field.FieldKey] = [];
      }
      existingValuesMap[field.FieldKey].push(field.Value);
    }

    for (const newField of newFields) {
      /**
       * Check if history tracking is enabled for this field.
       * EnableHistory comes from SystemFieldRegistry for system fields,
       * or from the FieldDefinitions table for custom fields.
       */
      if (!newField.EnableHistory) {
        continue;
      }

      const oldValues = existingValuesMap[newField.FieldKey] || [];
      const newValues = Array.isArray(newField.Value) ? newField.Value : [newField.Value];

      // Filter out empty values for comparison
      const filteredNewValues = newValues.filter(v => v && v.trim() !== '');

      const valuesChanged = oldValues.length !== filteredNewValues.length ||
        !oldValues.every((val, idx) => val === filteredNewValues[idx]);

      // Save new values to history when they change (ensures they survive merge conflicts)
      if (valuesChanged && filteredNewValues.length > 0) {
        yield* this.execute(FieldHistoryQueries.INSERT, [
          this.generateId(),
          itemId,
          manifestId,
          null,
          newField.FieldKey,
          JSON.stringify(filteredNewValues),
          currentDateTime,
          currentDateTime,
          currentDateTime,
          0
        ]);

        yield* this.pruneFieldHistory(itemId, manifestId, newField.FieldKey, currentDateTime);
      }
    }
  }

  /**
   * Prune old field history records.
   */
  private *pruneFieldHistory(
    itemId: string,
    manifestId: string,
    fieldKey: string,
    currentDateTime: string
  ): DbOp<void> {
    const matchingHistory = yield* this.query<{ Id: string; ChangedAt: string }>(FieldHistoryQueries.GET_FOR_PRUNING, [itemId, manifestId, fieldKey]);

    if (matchingHistory.length > MAX_FIELD_HISTORY_RECORDS) {
      const idsToDelete = matchingHistory.slice(MAX_FIELD_HISTORY_RECORDS).map(r => r.Id);

      if (idsToDelete.length > 0) {
        yield* this.execute(FieldHistoryQueries.softDeleteOld(idsToDelete.length), [currentDateTime, manifestId, ...idsToDelete]);
      }
    }
  }

  /**
   * Insert TOTP codes for a new item.
   */
  private *insertTotpCodes(itemId: string, totpCodes: TotpCode[], manifestId: string, currentDateTime: string): DbOp<void> {
    for (const totpCode of totpCodes) {
      yield* this.execute(TotpCodeQueries.INSERT, [
        totpCode.Id || this.generateId(),
        totpCode.Name,
        totpCode.SecretKey,
        normalizeTotpAlgorithm(totpCode.Algorithm),
        normalizeTotpDigits(totpCode.Digits),
        normalizeTotpPeriod(totpCode.Period),
        itemId,
        manifestId,
        currentDateTime,
        currentDateTime,
        0
      ]);
    }
  }

  /**
   * Handle TOTP code updates.
   */
  private *handleTotpCodes(
    itemId: string,
    manifestId: string,
    totpCodes: TotpCode[],
    originalIds: string[],
    currentDateTime: string
  ): DbOp<void> {
    // Fetch existing TOTP codes to compare values
    const existingTotpCodes = yield* this.query<TotpCode>(TotpCodeQueries.GET_BY_ITEM_ID, [itemId, manifestId]);

    const existingByIdMap = new Map(existingTotpCodes.map(tc => [tc.Id, tc]));

    for (const totpCode of totpCodes) {
      const wasOriginal = originalIds.includes(totpCode.Id);

      if (totpCode.IsDeleted) {
        if (wasOriginal) {
          yield* this.execute(TotpCodeQueries.SOFT_DELETE, [currentDateTime, totpCode.Id, manifestId]);
        }
      } else if (wasOriginal) {
        // Only update if values actually changed
        const existing = existingByIdMap.get(totpCode.Id);
        const algorithm = normalizeTotpAlgorithm(totpCode.Algorithm);
        const digits = normalizeTotpDigits(totpCode.Digits);
        const period = normalizeTotpPeriod(totpCode.Period);
        const changed = existing && (existing.Name !== totpCode.Name || existing.SecretKey !== totpCode.SecretKey ||
          existing.Algorithm !== algorithm || existing.Digits !== digits || existing.Period !== period);

        if (changed) {
          yield* this.execute(TotpCodeQueries.UPDATE, [totpCode.Name, totpCode.SecretKey, algorithm, digits, period, currentDateTime, totpCode.Id, manifestId]);
        }
      } else {
        yield* this.execute(TotpCodeQueries.INSERT, [
          totpCode.Id || this.generateId(),
          totpCode.Name,
          totpCode.SecretKey,
          normalizeTotpAlgorithm(totpCode.Algorithm),
          normalizeTotpDigits(totpCode.Digits),
          normalizeTotpPeriod(totpCode.Period),
          itemId,
          manifestId,
          currentDateTime,
          currentDateTime,
          0
        ]);
      }
    }
  }

  /**
   * The bytes of an attachment that is about to be inserted.
   */
  private attachmentBytes(attachment: Attachment): Uint8Array {
    const bytes = attachment.Blob instanceof Uint8Array ? attachment.Blob : new Uint8Array(attachment.Blob ?? []);
    if (bytes.length === 0) {
      throw new Error(`Attachment ${attachment.Filename} carries no bytes`);
    }
    return bytes;
  }

  /**
   * Insert attachments for a new item.
   */
  private *insertAttachments(itemId: string, attachments: Attachment[], manifestId: string, currentDateTime: string): DbOp<void> {
    for (const attachment of attachments) {
      const blobData = this.attachmentBytes(attachment);

      yield* this.execute(AttachmentQueries.INSERT, [
        attachment.Id || this.generateId(),
        attachment.Filename,
        blobData,
        itemId,
        manifestId,
        currentDateTime,
        currentDateTime,
        0
      ]);
    }
  }

  /**
   * Handle attachment updates.
   */
  private *handleAttachments(
    itemId: string,
    manifestId: string,
    attachments: Attachment[],
    originalIds: string[],
    currentDateTime: string
  ): DbOp<void> {
    // Track which original attachments are still present
    const currentAttachmentIds = new Set(attachments.map(a => a.Id));

    // Soft-delete any original attachments that are no longer in the list
    for (const originalId of originalIds) {
      if (!currentAttachmentIds.has(originalId)) {
        yield* this.execute(AttachmentQueries.SOFT_DELETE, [currentDateTime, originalId, manifestId]);
      }
    }

    // Process current attachments
    for (const attachment of attachments) {
      const wasOriginal = originalIds.includes(attachment.Id);

      if (attachment.IsDeleted) {
        if (wasOriginal) {
          yield* this.execute(AttachmentQueries.SOFT_DELETE, [currentDateTime, attachment.Id, manifestId]);
        }
      } else if (!wasOriginal) {
        const blobData = this.attachmentBytes(attachment);

        yield* this.execute(AttachmentQueries.INSERT, [
          attachment.Id || this.generateId(),
          attachment.Filename,
          blobData,
          itemId,
          manifestId,
          currentDateTime,
          currentDateTime,
          0
        ]);
      }
    }
  }
}
