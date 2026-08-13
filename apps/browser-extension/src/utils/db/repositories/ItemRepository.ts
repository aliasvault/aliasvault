import type { Item, ItemField, Attachment, TotpCode, FieldHistory, LogoSelection } from '@/utils/dist/core/models/vault';
import { FieldKey, LogoKinds, MAX_FIELD_HISTORY_RECORDS, normalizeTotpAlgorithm, normalizeTotpDigits, normalizeTotpPeriod } from '@/utils/dist/core/models/vault';
import { getFolderPath } from '@/utils/FolderUtils';

import { BaseRepository, type IDatabaseClient } from '../BaseRepository';
import { itemKeyBindings, scopedKey, type DraftItem, type ItemRef } from '../ItemRef';
import { FieldMapper, type FieldRow } from '../mappers/FieldMapper';
import { ItemMapper, type ItemRow, type TagRow, type ItemWithArchivedAt, type ItemWithDeletedAt } from '../mappers/ItemMapper';
import {
  ItemQueries,
  FieldValueQueries,
  FieldDefinitionQueries,
  FieldHistoryQueries,
  TotpCodeQueries,
  AttachmentQueries
} from '../queries/ItemQueries';

import type { Folder } from './FolderRepository';
import type { LogoRepository } from './LogoRepository';

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
  private buildFolderPaths(): Map<string, string[]> {
    const folderPathMap = new Map<string, string[]>();

    try {
      // Get all folders from database
      const folders = this.client.executeQuery<Folder & { ManifestId: string }>(
        'SELECT Id, ManifestId, Name, ParentFolderId, Weight FROM Folders WHERE IsDeleted = 0'
      );

      if (folders.length === 0) {
        return folderPathMap;
      }

      // Use shared utility to build paths, one manifest's tree at a time
      const foldersByManifest = new Map<string, (Folder & { ManifestId: string })[]>();
      for (const folder of folders) {
        const siblings = foldersByManifest.get(folder.ManifestId) ?? [];
        siblings.push(folder);
        foldersByManifest.set(folder.ManifestId, siblings);
      }

      for (const [manifestId, manifestFolders] of foldersByManifest) {
        for (const folder of manifestFolders) {
          const path = getFolderPath(folder.Id, manifestFolders);
          if (path.length > 0) {
            folderPathMap.set(scopedKey(manifestId, folder.Id), path);
          }
        }
      }

      return folderPathMap;
    } catch (error) {
      // Folders table may not exist in older vault versions
      if (error instanceof Error && error.message.includes('no such table')) {
        return folderPathMap;
      }
      throw error;
    }
  }

  /**
   * Fetch all active items with their dynamic fields and tags. Archived and trashed items are
   * excluded; this is what both the main item list and autofill read.
   * @returns Array of Item objects (empty array if Items table doesn't exist yet)
   */
  public getAll(): Item[] {
    return this.hydrateItems(this.selectItemRows(ItemQueries.GET_ALL_ACTIVE));
  }

  /**
   * Fetch all archived items with their dynamic fields and tags.
   * @returns Array of archived Item objects with ArchivedAt (empty array if Items table doesn't exist yet)
   */
  public getArchived(): ItemWithArchivedAt[] {
    const itemRows = this.selectItemRows(ItemQueries.GET_ARCHIVED);
    const items = this.hydrateItems(itemRows);
    return items.map((item, index) => ({ ...item, ArchivedAt: itemRows[index].ArchivedAt ?? undefined }));
  }

  /**
   * Get count of archived items.
   * @returns Number of archived items
   */
  public getArchivedCount(): number {
    try {
      const result = this.client.executeQuery<{ count: number }>(ItemQueries.COUNT_ARCHIVED);
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
   * @returns The raw item rows, or an empty array if the table does not exist yet
   */
  private selectItemRows(query: string): ItemRow[] {
    try {
      return this.client.executeQuery<ItemRow>(query);
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
  private hydrateItems(itemRows: ItemRow[]): Item[] {
    if (itemRows.length === 0) {
      return [];
    }

    /*
     * Items are matched on their whole key, so a shared manifest's item cannot pick up the fields or
     * tags of a personal item that happens to share its Id.
     */
    const itemRefs = itemRows.map(row => ({ Id: row.Id, ManifestId: row.ManifestId }));

    // Get all field values
    const fieldRows = this.client.executeQuery<FieldRow>(
      ItemQueries.getFieldValuesForItems(itemRefs.length),
      itemKeyBindings(itemRefs)
    );
    const fieldsByItem = FieldMapper.processFieldRows(fieldRows);

    // Get all tags
    const tagRows = this.client.executeQuery<TagRow>(
      ItemQueries.getTagsForItems(itemRefs.length),
      itemKeyBindings(itemRefs)
    );
    const tagsByItem = ItemMapper.groupTagsByItem(tagRows);

    // Build folder paths
    const folderPaths = this.buildFolderPaths();

    return ItemMapper.mapRows(itemRows, fieldsByItem, tagsByItem, folderPaths);
  }

  /**
   * Fetch a single item with its dynamic fields and tags.
   * @param itemId - The ID of the item to fetch
   * @param manifestId - The manifest the item belongs to, when known
   * @returns Item object or null if not found
   */
  public getById(itemId: string, manifestId?: string): Item | null {
    const ref = this.resolveItemRef(itemId, manifestId);
    if (!ref) {
      return null;
    }

    const results = this.client.executeQuery<ItemRow>(ItemQueries.GET_BY_ID, [ref.Id, ref.ManifestId]);
    if (results.length === 0) {
      return null;
    }

    // Get field values
    const fieldRows = this.client.executeQuery<Omit<FieldRow, 'ItemId' | 'ManifestId'>>(
      ItemQueries.GET_FIELD_VALUES_FOR_ITEM,
      [ref.Id, ref.ManifestId]
    );
    const fields = FieldMapper.processFieldRowsForSingleItem(fieldRows);

    // Get tags
    const tagRows = this.client.executeQuery<Omit<TagRow, 'ItemId' | 'ManifestId'>>(
      ItemQueries.GET_TAGS_FOR_ITEM,
      [ref.Id, ref.ManifestId]
    );
    const tags = ItemMapper.mapTagRows(tagRows);

    // Get folder path if item is in a folder
    let folderPath: string[] | undefined;
    if (results[0].FolderId) {
      const folderPaths = this.buildFolderPaths();
      folderPath = folderPaths.get(scopedKey(results[0].ManifestId, results[0].FolderId));
    }

    return ItemMapper.mapRow(results[0], fields, tags, folderPath);
  }

  /**
   * Resolve the manifest-qualified reference an item id names.
   * @param itemId - The item id
   * @param manifestId - The manifest the item belongs to, when known
   * @returns The item reference, or null when no such item exists
   */
  private resolveItemRef(itemId: string, manifestId?: string): ItemRef | null {
    if (manifestId) {
      return { Id: itemId, ManifestId: manifestId };
    }

    const resolved = this.resolveRowManifestId('Items', itemId);
    return resolved ? { Id: itemId, ManifestId: resolved } : null;
  }

  /**
   * Fetch the unique email addresses the vault still routes mail to, i.e. every live login email field the user
   * has not switched off. A switched-off alias keeps its claim link and its stored mail server-side, but the
   * client stops asking for its mailbox until it is switched back on.
   * @returns Array of email addresses
   */
  public getRoutableEmailAddresses(): string[] {
    const results = this.client.executeQuery<{ Email: string }>(
      ItemQueries.GET_ROUTABLE_EMAIL_ADDRESSES,
      [FieldKey.LoginEmail]
    );
    return results.map(row => row.Email);
  }

  /**
   * Check whether the vault still routes mail to one address. False once every live item carrying it has the
   * alias switched off, or when no live item carries it at all.
   * @param email - The full email address (local@domain) to check
   * @returns True when at least one live, switched-on login email field carries this address
   */
  public isEmailAddressRoutable(email: string): boolean {
    const results = this.client.executeQuery<{ Count: number }>(
      ItemQueries.COUNT_ROUTABLE_EMAIL_FIELDS,
      [FieldKey.LoginEmail, email.trim().toLowerCase()]
    );
    return (results[0]?.Count ?? 0) > 0;
  }

  /**
   * Find the item (id + name) associated with a given email address, if any.
   * @param email - The full email address (local@domain) to look up
   * @returns Object with Id and Name, or null when no active item uses this address
   */
  public findIdByEmail(email: string): { Id: string; Name: string | null } | null {
    const results = this.client.executeQuery<{ Id: string; Name: string | null }>(
      ItemQueries.GET_ITEM_BY_EMAIL,
      [FieldKey.LoginEmail, email]
    );
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Create a new item with field-based structure.
   * @param item The item object to insert
   * @param attachments Optional attachments to associate with the item
   * @param totpCodes Optional TOTP codes to associate with the item
   * @param logoSelection A logo the user picked or uploaded; omit to resolve the favicon from the URL
   * @returns The ID of the created item
   */
  public async create(
    item: DraftItem,
    attachments: Attachment[] = [],
    totpCodes: TotpCode[] = [],
    logoSelection?: LogoSelection
  ): Promise<string> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const itemId = item.Id || this.generateId();

      // 1. Handle the logo
      const logoId = await this.resolveLogoId(item, currentDateTime, null, logoSelection);

      // 2. Insert Item
      this.client.executeUpdate(ItemQueries.INSERT_ITEM, [
        itemId,
        item.Name ?? null,
        item.ItemType,
        logoId,
        item.FolderId ?? null,
        // Second bind of the folder id, then the manifest an item outside any folder joins (see INSERT_ITEM).
        item.FolderId ?? null,
        this.activeManifestId(),
        currentDateTime,
        currentDateTime,
        0
      ]);

      /*
       * 3-5. Insert the child rows. Each stamps itself with the manifest of the item it hangs off
       * (see BaseQueries.MANIFEST_OF_ITEM), which the INSERT above has just decided from the folder.
       */
      if (item.Fields && item.Fields.length > 0) {
        this.insertFieldValues(itemId, item.Fields, item.ItemType, currentDateTime);
      }

      this.insertTotpCodes(itemId, totpCodes, currentDateTime);
      this.insertAttachments(itemId, attachments, currentDateTime);

      return itemId;
    });
  }

  /**
   * Duplicate an item including all fields. Data that is not duplicated is passkeys and field history.
   * @param itemId - The ID of the item to duplicate
   * @param manifestId - The manifest the item belongs to, when known
   * @returns The ID of the newly created item
   */
  public async duplicate(itemId: string, manifestId?: string): Promise<string> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const newItemId = this.generateId();
      const ref = this.resolveItemRef(itemId, manifestId);
      if (!ref) {
        throw new Error(`Item not found: ${itemId}`);
      }

      const sourceRows = this.client.executeQuery<{ Name: string | null }>(
        'SELECT Name FROM Items WHERE Id = ? AND ManifestId = ? AND IsDeleted = 0',
        [ref.Id, ref.ManifestId]
      );
      if (sourceRows.length === 0) {
        throw new Error(`Item not found: ${itemId}`);
      }

      const existingNames = this.client.executeQuery<{ Name: string | null }>(
        'SELECT Name FROM Items WHERE IsDeleted = 0 AND DeletedAt IS NULL'
      );
      const newName = ItemRepository.generateCopyName(
        sourceRows[0].Name,
        existingNames.map(row => row.Name)
      );

      /*
       * 1. Copy the item row itself (same logo, folder and type).
       */
      this.client.executeUpdate(`
        INSERT INTO Items (Id, Name, ItemType, LogoId, FolderId, ManifestId, CreatedAt, UpdatedAt, IsDeleted)
        SELECT ?, ?, ItemType, LogoId, FolderId, ManifestId, ?, ?, 0 FROM Items WHERE Id = ? AND ManifestId = ?`,
      [newItemId, newName, currentDateTime, currentDateTime, ref.Id, ref.ManifestId]);

      /*
       * 2. Copy custom field definitions so later edits to the duplicate's
       * custom fields don't affect the original item.
       */
      const definitionRows = this.client.executeQuery<{ Id: string }>(
        `SELECT DISTINCT FieldDefinitionId as Id FROM FieldValues
         WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0 AND FieldDefinitionId IS NOT NULL`,
        [ref.Id, ref.ManifestId]
      );
      const definitionIdMap = new Map<string, string>();
      for (const definition of definitionRows) {
        const newDefinitionId = this.generateId();
        definitionIdMap.set(definition.Id, newDefinitionId);
        this.client.executeUpdate(`
          INSERT INTO FieldDefinitions (Id, ManifestId, FieldType, Label, IsMultiValue, IsHidden, EnableHistory, Weight, ApplicableToTypes, CreatedAt, UpdatedAt, IsDeleted)
          SELECT ?, ManifestId, FieldType, Label, IsMultiValue, IsHidden, EnableHistory, Weight, ApplicableToTypes, ?, ?, 0
          FROM FieldDefinitions WHERE Id = ? AND ManifestId = ?`,
        [newDefinitionId, currentDateTime, currentDateTime, definition.Id, ref.ManifestId]);
      }

      // 3. Copy field values, remapping custom fields to the copied definitions.
      const fieldValueRows = this.client.executeQuery<{ Id: string; FieldDefinitionId: string | null }>(
        'SELECT Id, FieldDefinitionId FROM FieldValues WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0',
        [ref.Id, ref.ManifestId]
      );
      for (const row of fieldValueRows) {
        this.client.executeUpdate(`
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
          sql: `INSERT INTO Attachments (Id, ItemId, ManifestId, Filename, Blob, CreatedAt, UpdatedAt, IsDeleted)
                SELECT ?, ?, ManifestId, Filename, Blob, ?, ?, 0 FROM Attachments WHERE Id = ? AND ManifestId = ?`,
        },
        {
          table: 'ItemTags',
          sql: `INSERT INTO ItemTags (Id, ItemId, ManifestId, TagId, CreatedAt, UpdatedAt, IsDeleted)
                SELECT ?, ?, ManifestId, TagId, ?, ?, 0 FROM ItemTags WHERE Id = ? AND ManifestId = ?`,
        },
      ];

      for (const copy of childCopies) {
        const rows = this.client.executeQuery<{ Id: string }>(
          `SELECT Id FROM ${copy.table} WHERE ItemId = ? AND ManifestId = ? AND IsDeleted = 0`,
          [ref.Id, ref.ManifestId]
        );
        for (const row of rows) {
          this.client.executeUpdate(copy.sql, [this.generateId(), newItemId, currentDateTime, currentDateTime, row.Id, ref.ManifestId]);
        }
      }

      return newItemId;
    });
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
   * @param item The item object to update
   * @param originalAttachmentIds Original attachment IDs for tracking changes
   * @param attachments Current attachments list
   * @param originalTotpCodeIds Original TOTP code IDs for tracking changes
   * @param totpCodes Current TOTP codes list
   * @param logoSelection A logo the user picked or uploaded; omit to leave the current logo logic alone
   * @returns The number of rows modified
   */
  public async update(
    item: DraftItem,
    originalAttachmentIds: string[] = [],
    attachments: Attachment[] = [],
    originalTotpCodeIds: string[] = [],
    totpCodes: TotpCode[] = [],
    logoSelection?: LogoSelection
  ): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();

      // Every row this write touches stays inside the item's own manifest.
      const ref = this.resolveItemRef(item.Id, item.ManifestId);
      if (!ref) {
        return 0;
      }

      // 1. Read the stored item first: resolving the logo needs to know which one it already has.
      const existing = this.client.executeQuery<{
        Name: string | null;
        ItemType: number;
        FolderId: string | null;
        LogoId: string | null;
      }>(ItemQueries.GET_ITEM_FIELDS, [ref.Id, ref.ManifestId])[0];

      // 2. Handle the logo
      const logoId = await this.resolveLogoId(item, currentDateTime, existing?.LogoId ?? null, logoSelection);

      if (existing) {
        const nameChanged = (item.Name ?? null) !== existing.Name;
        const itemTypeChanged = String(item.ItemType) !== String(existing.ItemType);
        const folderIdChanged = (item.FolderId ?? null) !== existing.FolderId;
        const logoIdChanged = logoId !== existing.LogoId;

        if (nameChanged || itemTypeChanged || folderIdChanged || logoIdChanged) {
          // Use UPDATE_ITEM_WITH_LOGO to allow explicit clearing of LogoId
          this.client.executeUpdate(ItemQueries.UPDATE_ITEM_WITH_LOGO, [
            item.Name ?? null,
            item.ItemType,
            item.FolderId ?? null,
            // Moving an item across a folder boundary moves it across a manifest boundary: re-stamp it.
            item.FolderId ?? null,
            this.activeManifestId(),
            logoId,
            currentDateTime,
            ref.Id,
            // The row is addressed by the manifest it is in *now*; the SET above may move it.
            ref.ManifestId
          ]);
        }
      }

      // 3. Track history for fields that have EnableHistory=true before updating
      await this.trackFieldHistory(ref.Id, ref.ManifestId, item.Fields, currentDateTime);

      // 4. Update field values
      this.updateFieldValues(item, ref.ManifestId, currentDateTime);

      // 5. Handle TOTP codes
      this.handleTotpCodes(ref.Id, ref.ManifestId, totpCodes, originalTotpCodeIds, currentDateTime);

      // 6. Handle attachments
      this.handleAttachments(ref.Id, ref.ManifestId, attachments, originalAttachmentIds, currentDateTime);

      return 1;
    });
  }

  /**
   * Move an item to "Recently Deleted" (trash).
   * @param itemId - The ID of the item to trash
   * @param manifestId - The manifest the item belongs to, when known
   * @returns The number of rows updated
   */
  public async trash(itemId: string, manifestId?: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const ref = this.resolveItemRef(itemId, manifestId);
      if (!ref) {
        return 0;
      }
      return this.client.executeUpdate(ItemQueries.TRASH_ITEM, [
        currentDateTime,
        currentDateTime,
        ref.Id,
        ref.ManifestId
      ]);
    });
  }

  /**
   * Restore an item from "Recently Deleted".
   * @param itemId - The ID of the item to restore
   * @param manifestId - The manifest the item belongs to, when known
   * @returns The number of rows updated
   */
  public async restore(itemId: string, manifestId?: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const ref = this.resolveItemRef(itemId, manifestId);
      if (!ref) {
        return 0;
      }
      return this.client.executeUpdate(ItemQueries.RESTORE_ITEM, [
        currentDateTime,
        ref.Id,
        ref.ManifestId
      ]);
    });
  }

  /**
   * Archive an item: it disappears from the main list and from autofill, but keeps all of its data
   * and its email aliases, and is never auto-pruned.
   * @param itemId - The ID of the item to archive
   * @param manifestId - The manifest the item belongs to, when known
   * @returns The number of rows updated
   */
  public async archive(itemId: string, manifestId?: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const ref = this.resolveItemRef(itemId, manifestId);
      if (!ref) {
        return 0;
      }
      return this.client.executeUpdate(ItemQueries.ARCHIVE_ITEM, [
        currentDateTime,
        currentDateTime,
        ref.Id,
        ref.ManifestId
      ]);
    });
  }

  /**
   * Unarchive an item, returning it to the main list and to autofill.
   * @param itemId - The ID of the item to unarchive
   * @param manifestId - The manifest the item belongs to, when known
   * @returns The number of rows updated
   */
  public async unarchive(itemId: string, manifestId?: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const ref = this.resolveItemRef(itemId, manifestId);
      if (!ref) {
        return 0;
      }
      return this.client.executeUpdate(ItemQueries.UNARCHIVE_ITEM, [
        currentDateTime,
        ref.Id,
        ref.ManifestId
      ]);
    });
  }

  /**
   * Permanently delete an item - converts to tombstone for sync.
   * @param itemId - The ID of the item to permanently delete
   * @param manifestId - The manifest the item belongs to, when known
   * @returns The number of rows updated
   */
  public async permanentlyDelete(itemId: string, manifestId?: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const ref = this.resolveItemRef(itemId, manifestId);
      if (!ref) {
        return 0;
      }

      // Hard delete all related entities within this item's manifest.
      for (const table of ['FieldValues', 'FieldHistories', 'Passkeys', 'TotpCodes', 'Attachments', 'ItemTags']) {
        this.hardDeleteByScopedForeignKey(table, 'ItemId', ref.Id, ref.ManifestId);
      }

      // Convert item to tombstone.
      return this.client.executeUpdate(ItemQueries.TOMBSTONE_ITEM, [
        currentDateTime,
        ref.Id,
        ref.ManifestId
      ]);
    });
  }

  /**
   * Get all items in "Recently Deleted".
   * @returns Array of trashed Item objects with DeletedAt
   */
  public getRecentlyDeleted(): ItemWithDeletedAt[] {
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

      itemRows = this.client.executeQuery(query);
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
    const fieldRows = this.client.executeQuery<FieldRow>(
      ItemQueries.getFieldValuesForItems(itemRefs.length),
      itemKeyBindings(itemRefs)
    );
    const fieldsByItem = FieldMapper.processFieldRows(fieldRows);

    // Build folder paths
    const folderPaths = this.buildFolderPaths();

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
  public getRecentlyDeletedCount(): number {
    try {
      const result = this.client.executeQuery<{ count: number }>(ItemQueries.COUNT_RECENTLY_DELETED);
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
   * @param itemId - The ID of the item to get TOTP codes for
   * @param manifestId - The manifest the item belongs to, when known
   * @returns Array of TotpCode objects
   */
  public getTotpCodesForItem(itemId: string, manifestId?: string): TotpCode[] {
    const ref = this.resolveItemRef(itemId, manifestId);
    if (!ref) {
      return [];
    }
    return this.client.executeQuery<TotpCode>(TotpCodeQueries.GET_BY_ITEM_ID, [ref.Id, ref.ManifestId]);
  }

  /**
   * Get an item's attachments.
   * @param itemId - The ID of the item
   * @param manifestId - The manifest the item belongs to, when known
   * @returns Array of attachments for the item
   */
  public getAttachmentsForItem(itemId: string, manifestId?: string): Attachment[] {
    const ref = this.resolveItemRef(itemId, manifestId);
    if (!ref) {
      return [];
    }
    return this.client.executeQuery<Attachment>(AttachmentQueries.GET_BY_ITEM_ID, [ref.Id, ref.ManifestId]);
  }

  /**
   * Get field history for a specific field.
   * @param itemId - The ID of the item
   * @param fieldKey - The field key to get history for
   * @param manifestId - The manifest the item belongs to, when known
   * @returns Array of field history records
   */
  public getFieldHistory(itemId: string, fieldKey: string, manifestId?: string): FieldHistory[] {
    const ref = this.resolveItemRef(itemId, manifestId);
    if (!ref) {
      return [];
    }

    const results = this.client.executeQuery<{
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
   * @param manifestId - The manifest the record belongs to, when known
   * @returns Number of rows affected
   */
  public async deleteFieldHistory(historyId: string, manifestId?: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const scope = manifestId ?? this.resolveRowManifestId('FieldHistories', historyId);
      if (!scope) {
        return 0;
      }
      return this.client.executeUpdate(FieldHistoryQueries.SOFT_DELETE, [
        currentDateTime,
        historyId,
        scope
      ]);
    });
  }

  /**
   * Resolve which logo row an item points at.
   *
   * The rules, in order:
   *   1. an explicit selection wins: the user picked a built-in logo, uploaded an image, or asked to
   *      go back to the automatic favicon;
   *   2. otherwise a logo the user chose earlier (built-in or uploaded) is kept, so editing the URL
   *      never silently replaces a deliberate choice with a favicon;
   *   3. otherwise the favicon for the item's current domain, which is looked up rather than carried
   *      over: an item whose URL changed must not keep the previous site's logo.
   *
   * Rule 2 also keeps the logo of an item inside a shared manifest pointing at the manifest's own row.
   * Re-resolving would swap in the personal-scope row, which the next push would then copy over the
   * shared manifest's logo: a write every member sees, every time anyone edits the item.
   * @param item The item being created or updated
   * @param currentDateTime The current date/time string for timestamps
   * @param existingLogoId The logo the item currently has, when updating
   * @param selection A logo the user explicitly picked or uploaded
   * @returns The logo ID to store on the item, or null when it should have none
   */
  private async resolveLogoId(
    item: DraftItem,
    currentDateTime: string,
    existingLogoId: string | null = null,
    selection?: LogoSelection
  ): Promise<string | null> {
    const scope = this.manifestOfFolder(item.FolderId ?? null);

    if (selection && selection.Kind !== LogoKinds.Favicon) {
      return this.resolveSelectedLogo(selection, scope, currentDateTime);
    }

    const existing = existingLogoId ? this.logoRepository.getById(existingLogoId) : null;
    if (!selection && existing && existing.Kind !== LogoKinds.Favicon) {
      return this.logoRepository.adoptIntoScope(scope, existing.Kind, existing.Source, currentDateTime);
    }

    const urlField = item.Fields?.find(f => f.FieldKey === 'login.url');
    const urlValue = urlField?.Value;
    const urls = Array.isArray(urlValue) ? urlValue : (urlValue ? [urlValue] : []);
    // The first URL a domain can be read from, which is the one the favicon was fetched for.
    const source = urls.map(url => this.logoRepository.extractSourceFromUrl(url)).find(candidate => candidate !== 'unknown') ?? 'unknown';

    /*
     * Without a domain there is no natural key to store a favicon under: 'unknown' is not one, every
     * item with an unparseable URL would end up sharing (and overwriting) the same row.
     */
    if (source === 'unknown') {
      return null;
    }

    // Keep the current favicon when it is already this domain's, whatever scope it lives in.
    if (existing && existing.Kind === LogoKinds.Favicon && existing.Source === source) {
      return this.logoRepository.adoptIntoScope(scope, LogoKinds.Favicon, source, currentDateTime);
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
     * Otherwise adopt the favicon this domain already has, or none at all. Falling back to the item's
     * previous logo here is what made an item keep the old site's logo after its URL was changed.
     */
    return this.logoRepository.adoptIntoScope(scope, LogoKinds.Favicon, source, currentDateTime);
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
    return selection.Source ? this.logoRepository.adoptIntoScope(scope, LogoKinds.Custom, selection.Source, currentDateTime) : null;
  }

  /**
   * Insert field values for a new item.
   * Also creates history records for fields with EnableHistory=true.
   */
  private insertFieldValues(
    itemId: string,
    fields: ItemField[],
    itemType: string,
    currentDateTime: string
  ): void {
    for (const field of fields) {
      // Skip empty system fields, but always persist custom fields (even if empty)
      const isEmpty = !field.Value || (typeof field.Value === 'string' && field.Value.trim() === '');
      if (isEmpty && !field.IsCustomField) {
        continue;
      }

      let fieldDefinitionId = null;

      // For custom fields, create or get FieldDefinition
      if (field.IsCustomField) {
        fieldDefinitionId = this.ensureFieldDefinition(field, itemId, itemType, currentDateTime);
      }

      // Handle multi-value fields
      const values = Array.isArray(field.Value) ? field.Value : [field.Value];
      const filteredValues = values.filter(v => v && v.trim() !== '');

      // For custom fields with no values, insert with empty string to preserve the field
      const valuesToInsert = field.IsCustomField && filteredValues.length === 0
        ? ['']
        : filteredValues;

      for (const value of valuesToInsert) {
        this.client.executeUpdate(FieldValueQueries.INSERT, [
          this.generateId(),
          itemId,
          itemId,
          this.activeManifestId(),
          fieldDefinitionId,
          field.IsCustomField ? null : field.FieldKey,
          value,
          field.DisplayOrder ?? 0,
          currentDateTime,
          currentDateTime,
          0
        ]);
      }

      // Create history record for fields with EnableHistory=true
      if (field.EnableHistory && filteredValues.length > 0) {
        const historyId = this.generateId();
        const valueSnapshot = JSON.stringify(filteredValues);

        this.client.executeUpdate(FieldHistoryQueries.INSERT, [
          historyId,
          itemId,
          itemId,
          this.activeManifestId(),
          null,
          field.FieldKey,
          valueSnapshot,
          currentDateTime,
          currentDateTime,
          currentDateTime,
          0
        ]);
      }
    }
  }

  /**
   * Ensure a field definition exists for a custom field.
   */
  private ensureFieldDefinition(
    field: ItemField,
    itemId: string,
    itemType: string,
    currentDateTime: string
  ): string {
    const existingDef = this.client.executeQuery<{ Id: string }>(
      FieldDefinitionQueries.EXISTS,
      [field.FieldKey, itemId, this.activeManifestId()]
    );

    if (existingDef.length === 0) {
      this.client.executeUpdate(FieldDefinitionQueries.INSERT, [
        field.FieldKey,
        itemId,
        this.activeManifestId(),
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
    }

    return field.FieldKey;
  }

  /**
   * Update field values for an existing item.
   */
  private updateFieldValues(item: DraftItem, manifestId: string, currentDateTime: string): void {
    // Get existing FieldValues
    const existingFieldValues = this.client.executeQuery<{
      Id: string;
      FieldKey: string | null;
      FieldDefinitionId: string | null;
      Value: string;
      Weight: number;
    }>(FieldValueQueries.GET_EXISTING_FOR_ITEM, [item.Id, manifestId]);

    // Build a map of existing FieldValues by key:index
    const existingByKey = new Map<string, { Id: string; Value: string; Weight: number }>();
    const fieldValueCounts = new Map<string, number>();

    for (const fv of existingFieldValues) {
      const key = fv.FieldKey || fv.FieldDefinitionId || '';
      const count = fieldValueCounts.get(key) || 0;
      existingByKey.set(`${key}:${count}`, { Id: fv.Id, Value: fv.Value, Weight: fv.Weight });
      fieldValueCounts.set(key, count + 1);
    }

    const processedIds = new Set<string>();

    // Update existing or insert new FieldValues
    if (item.Fields && item.Fields.length > 0) {
      for (const field of item.Fields) {
        // Skip empty system fields, but always persist custom fields (even if empty)
        const isEmpty = !field.Value || (typeof field.Value === 'string' && field.Value.trim() === '');
        if (isEmpty && !field.IsCustomField) {
          continue;
        }

        let fieldDefinitionId = null;

        if (field.IsCustomField) {
          fieldDefinitionId = this.ensureOrUpdateFieldDefinition(field, item.Id, item.ItemType, currentDateTime);
        }

        const values = Array.isArray(field.Value) ? field.Value : [field.Value];
        const effectiveKey = field.FieldKey;

        // For custom fields with no values, use empty string to preserve the field
        const filteredValues = values.filter(v => v && (typeof v !== 'string' || v.trim() !== ''));
        const valuesToProcess = field.IsCustomField && filteredValues.length === 0
          ? ['']
          : filteredValues;

        for (let i = 0; i < valuesToProcess.length; i++) {
          const value = valuesToProcess[i];

          const lookupKey = `${effectiveKey}:${i}`;
          const existing = existingByKey.get(lookupKey);

          if (existing) {
            processedIds.add(existing.Id);
            const newWeight = field.DisplayOrder ?? 0;
            if (existing.Value !== value || existing.Weight !== newWeight) {
              this.client.executeUpdate(FieldValueQueries.UPDATE, [
                value,
                newWeight,
                currentDateTime,
                existing.Id,
                manifestId
              ]);
            }
          } else {
            this.client.executeUpdate(FieldValueQueries.INSERT, [
              this.generateId(),
              item.Id,
              item.Id,
              this.activeManifestId(),
              fieldDefinitionId,
              field.IsCustomField ? null : field.FieldKey,
              value,
              field.DisplayOrder ?? 0,
              currentDateTime,
              currentDateTime,
              0
            ]);
          }
        }
      }
    }

    // Soft-delete any FieldValues that were not processed
    for (const fv of existingFieldValues) {
      if (!processedIds.has(fv.Id)) {
        this.client.executeUpdate(FieldValueQueries.SOFT_DELETE, [currentDateTime, fv.Id, manifestId]);
      }
    }
  }

  /**
   * Ensure a field definition exists and is up-to-date.
   */
  private ensureOrUpdateFieldDefinition(
    field: ItemField,
    itemId: string,
    itemType: string,
    currentDateTime: string
  ): string {
    const existingDef = this.client.executeQuery<{ Id: string }>(
      FieldDefinitionQueries.EXISTS_ACTIVE,
      [field.FieldKey, itemId, this.activeManifestId()]
    );

    if (existingDef.length === 0) {
      this.client.executeUpdate(FieldDefinitionQueries.INSERT, [
        field.FieldKey,
        itemId,
        this.activeManifestId(),
        field.FieldType,
        field.Label,
        0,
        field.IsHidden ? 1 : 0,
        0,
        field.DisplayOrder ?? 0,
        itemType,
        currentDateTime,
        currentDateTime,
        0
      ]);
    } else {
      this.client.executeUpdate(FieldDefinitionQueries.UPDATE, [
        field.Label,
        field.FieldType,
        field.IsHidden ? 1 : 0,
        field.DisplayOrder ?? 0,
        currentDateTime,
        field.FieldKey,
        itemId,
        this.activeManifestId()
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
  private async trackFieldHistory(
    itemId: string,
    manifestId: string,
    newFields: ItemField[],
    currentDateTime: string
  ): Promise<void> {
    const existingFields = this.client.executeQuery<{ FieldKey: string; Value: string }>(
      FieldValueQueries.GET_FOR_HISTORY,
      [itemId, manifestId]
    );

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
        const historyId = this.generateId();
        const valueSnapshot = JSON.stringify(filteredNewValues);

        this.client.executeUpdate(FieldHistoryQueries.INSERT, [
          historyId,
          itemId,
          itemId,
          this.activeManifestId(),
          null,
          newField.FieldKey,
          valueSnapshot,
          currentDateTime,
          currentDateTime,
          currentDateTime,
          0
        ]);

        await this.pruneFieldHistory(itemId, manifestId, newField.FieldKey, currentDateTime);
      }
    }
  }

  /**
   * Prune old field history records.
   */
  private async pruneFieldHistory(
    itemId: string,
    manifestId: string,
    fieldKey: string,
    currentDateTime: string
  ): Promise<void> {
    const matchingHistory = this.client.executeQuery<{ Id: string; ChangedAt: string }>(
      FieldHistoryQueries.GET_FOR_PRUNING,
      [itemId, manifestId, fieldKey]
    );

    if (matchingHistory.length > MAX_FIELD_HISTORY_RECORDS) {
      const recordsToDelete = matchingHistory.slice(MAX_FIELD_HISTORY_RECORDS);
      const idsToDelete = recordsToDelete.map(r => r.Id);

      if (idsToDelete.length > 0) {
        this.client.executeUpdate(
          FieldHistoryQueries.softDeleteOld(idsToDelete.length),
          [currentDateTime, manifestId, ...idsToDelete]
        );
      }
    }
  }

  /**
   * Insert TOTP codes for a new item.
   */
  private insertTotpCodes(itemId: string, totpCodes: TotpCode[], currentDateTime: string): void {
    for (const totpCode of totpCodes) {
      this.client.executeUpdate(
        TotpCodeQueries.INSERT,
        [
          totpCode.Id || this.generateId(),
          totpCode.Name,
          totpCode.SecretKey,
          normalizeTotpAlgorithm(totpCode.Algorithm),
          normalizeTotpDigits(totpCode.Digits),
          normalizeTotpPeriod(totpCode.Period),
          itemId,
          itemId,
          this.activeManifestId(),
          currentDateTime,
          currentDateTime,
          0
        ]
      );
    }
  }

  /**
   * Handle TOTP code updates.
   */
  private handleTotpCodes(
    itemId: string,
    manifestId: string,
    totpCodes: TotpCode[],
    originalIds: string[],
    currentDateTime: string
  ): void {
    // Fetch existing TOTP codes to compare values
    const existingTotpCodes = this.client.executeQuery<TotpCode>(TotpCodeQueries.GET_BY_ITEM_ID, [itemId, manifestId]);

    const existingByIdMap = new Map(existingTotpCodes.map(tc => [tc.Id, tc]));

    for (const totpCode of totpCodes) {
      const wasOriginal = originalIds.includes(totpCode.Id);

      if (totpCode.IsDeleted) {
        if (wasOriginal) {
          this.client.executeUpdate(
            TotpCodeQueries.SOFT_DELETE,
            [currentDateTime, totpCode.Id, manifestId]
          );
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
          this.client.executeUpdate(
            TotpCodeQueries.UPDATE,
            [totpCode.Name, totpCode.SecretKey, algorithm, digits, period, currentDateTime, totpCode.Id, manifestId]
          );
        }
      } else {
        this.client.executeUpdate(
          TotpCodeQueries.INSERT,
          [
            totpCode.Id || this.generateId(),
            totpCode.Name,
            totpCode.SecretKey,
            normalizeTotpAlgorithm(totpCode.Algorithm),
            normalizeTotpDigits(totpCode.Digits),
            normalizeTotpPeriod(totpCode.Period),
            itemId,
            itemId,
            this.activeManifestId(),
            currentDateTime,
            currentDateTime,
            0
          ]
        );
      }
    }
  }

  /**
   * Insert attachments for a new item.
   */
  private insertAttachments(itemId: string, attachments: Attachment[], currentDateTime: string): void {
    for (const attachment of attachments) {
      const blobData = attachment.Blob instanceof Uint8Array
        ? attachment.Blob
        : new Uint8Array(attachment.Blob);

      this.client.executeUpdate(
        AttachmentQueries.INSERT,
        [
          attachment.Id || this.generateId(),
          attachment.Filename,
          blobData,
          itemId,
          itemId,
          this.activeManifestId(),
          currentDateTime,
          currentDateTime,
          0
        ]
      );
    }
  }

  /**
   * Handle attachment updates.
   */
  private handleAttachments(
    itemId: string,
    manifestId: string,
    attachments: Attachment[],
    originalIds: string[],
    currentDateTime: string
  ): void {
    // Track which original attachments are still present
    const currentAttachmentIds = new Set(attachments.map(a => a.Id));

    // Soft-delete any original attachments that are no longer in the list
    for (const originalId of originalIds) {
      if (!currentAttachmentIds.has(originalId)) {
        this.client.executeUpdate(
          AttachmentQueries.SOFT_DELETE,
          [currentDateTime, originalId, manifestId]
        );
      }
    }

    // Process current attachments
    for (const attachment of attachments) {
      const wasOriginal = originalIds.includes(attachment.Id);

      if (attachment.IsDeleted) {
        if (wasOriginal) {
          this.client.executeUpdate(
            AttachmentQueries.SOFT_DELETE,
            [currentDateTime, attachment.Id, manifestId]
          );
        }
      } else if (!wasOriginal) {
        const blobData = attachment.Blob instanceof Uint8Array
          ? attachment.Blob
          : new Uint8Array(attachment.Blob);

        this.client.executeUpdate(
          AttachmentQueries.INSERT,
          [
            attachment.Id || this.generateId(),
            attachment.Filename,
            blobData,
            itemId,
            itemId,
            this.activeManifestId(),
            currentDateTime,
            currentDateTime,
            0
          ]
        );
      }
    }
  }
}
