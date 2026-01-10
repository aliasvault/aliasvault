import type { Item, ItemField, Attachment, TotpCode, FieldHistory } from '@/utils/dist/core/models/vault';
import { FieldKey, MAX_FIELD_HISTORY_RECORDS } from '@/utils/dist/core/models/vault';

import { BaseRepository, type IDatabaseClient } from '../BaseRepository';
import { FieldMapper, type FieldRow } from '../mappers/FieldMapper';
import { ItemMapper, type ItemRow, type TagRow, type ItemWithDeletedAt } from '../mappers/ItemMapper';
import {
  ItemQueries,
  FieldValueQueries,
  FieldDefinitionQueries,
  FieldHistoryQueries
} from '../queries/ItemQueries';

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
   * Fetch all active items with their dynamic fields and tags.
   * @returns Array of Item objects (empty array if Items table doesn't exist yet)
   */
  public getAll(): Item[] {
    let itemRows: ItemRow[];
    try {
      itemRows = this.client.executeQuery<ItemRow>(ItemQueries.GET_ALL_ACTIVE);
    } catch (error) {
      // Items table may not exist in older vault versions - return empty array
      if (error instanceof Error && error.message.includes('no such table')) {
        return [];
      }
      throw error;
    }

    if (itemRows.length === 0) {
      return [];
    }

    const itemIds = itemRows.map(i => i.Id);

    // Get all field values
    const fieldRows = this.client.executeQuery<FieldRow>(
      ItemQueries.getFieldValuesForItems(itemIds.length),
      itemIds
    );
    const fieldsByItem = FieldMapper.processFieldRows(fieldRows);

    // Get all tags
    const tagRows = this.client.executeQuery<TagRow>(
      ItemQueries.getTagsForItems(itemIds.length),
      itemIds
    );
    const tagsByItem = ItemMapper.groupTagsByItem(tagRows);

    return ItemMapper.mapRows(itemRows, fieldsByItem, tagsByItem);
  }

  /**
   * Fetch a single item by ID with its dynamic fields and tags.
   * @param itemId - The ID of the item to fetch
   * @returns Item object or null if not found
   */
  public getById(itemId: string): Item | null {
    const results = this.client.executeQuery<ItemRow>(ItemQueries.GET_BY_ID, [itemId]);
    if (results.length === 0) {
      return null;
    }

    // Get field values
    const fieldRows = this.client.executeQuery<Omit<FieldRow, 'ItemId'>>(
      ItemQueries.GET_FIELD_VALUES_FOR_ITEM,
      [itemId]
    );
    const fields = FieldMapper.processFieldRowsForSingleItem(fieldRows);

    // Get tags
    const tagRows = this.client.executeQuery<Omit<TagRow, 'ItemId'>>(
      ItemQueries.GET_TAGS_FOR_ITEM,
      [itemId]
    );
    const tags = ItemMapper.mapTagRows(tagRows);

    return ItemMapper.mapRow(results[0], fields, tags);
  }

  /**
   * Fetch all unique email addresses from all items.
   * @returns Array of email addresses
   */
  public getAllEmailAddresses(): string[] {
    const results = this.client.executeQuery<{ Email: string }>(
      ItemQueries.GET_ALL_EMAIL_ADDRESSES,
      [FieldKey.LoginEmail]
    );
    return results.map(row => row.Email);
  }

  /**
   * Create a new item with field-based structure.
   * @param item The item object to insert
   * @param attachments Optional attachments to associate with the item
   * @param totpCodes Optional TOTP codes to associate with the item
   * @returns The ID of the created item
   */
  public async create(
    item: Item,
    attachments: Attachment[] = [],
    totpCodes: TotpCode[] = []
  ): Promise<string> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      const itemId = item.Id || this.generateId();

      // 1. Handle Logo
      const logoId = this.resolveLogoId(item, currentDateTime);

      // 2. Insert Item
      this.client.executeUpdate(ItemQueries.INSERT_ITEM, [
        itemId,
        item.Name ?? null,
        item.ItemType,
        logoId,
        item.FolderId ?? null,
        currentDateTime,
        currentDateTime,
        0
      ]);

      // 3. Insert FieldValues for all fields
      if (item.Fields && item.Fields.length > 0) {
        this.insertFieldValues(itemId, item.Fields, item.ItemType, currentDateTime);
      }

      // 4. Insert TOTP codes
      this.insertTotpCodes(itemId, totpCodes, currentDateTime);

      // 5. Insert attachments
      this.insertAttachments(itemId, attachments, currentDateTime);

      return itemId;
    });
  }

  /**
   * Update an existing item with field-based structure.
   * @param item The item object to update
   * @param originalAttachmentIds Original attachment IDs for tracking changes
   * @param attachments Current attachments list
   * @param originalTotpCodeIds Original TOTP code IDs for tracking changes
   * @param totpCodes Current TOTP codes list
   * @returns The number of rows modified
   */
  public async update(
    item: Item,
    originalAttachmentIds: string[] = [],
    attachments: Attachment[] = [],
    originalTotpCodeIds: string[] = [],
    totpCodes: TotpCode[] = []
  ): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();

      // 1. Handle Logo
      const logoId = this.resolveLogoId(item, currentDateTime);

      // 2. Update Item only if item-level fields changed
      const existing = this.client.executeQuery<{
        Name: string | null;
        ItemType: number;
        FolderId: string | null;
        LogoId: string | null;
      }>(`SELECT Name, ItemType, FolderId, LogoId FROM Items WHERE Id = ?`, [item.Id])[0];

      if (existing) {
        const nameChanged = (item.Name ?? null) !== existing.Name;
        const itemTypeChanged = String(item.ItemType) !== String(existing.ItemType);
        const folderIdChanged = (item.FolderId ?? null) !== existing.FolderId;
        const logoIdChanged = logoId !== null && logoId !== existing.LogoId;

        if (nameChanged || itemTypeChanged || folderIdChanged || logoIdChanged) {
          this.client.executeUpdate(ItemQueries.UPDATE_ITEM, [
            item.Name ?? null,
            item.ItemType,
            item.FolderId ?? null,
            logoId,
            currentDateTime,
            item.Id
          ]);
        }
      }

      // 3. Track history for fields that have EnableHistory=true before updating
      await this.trackFieldHistory(item.Id, item.Fields, currentDateTime);

      // 4. Update field values
      this.updateFieldValues(item, currentDateTime);

      // 5. Handle TOTP codes
      this.handleTotpCodes(item.Id, totpCodes, originalTotpCodeIds, currentDateTime);

      // 6. Handle attachments
      this.handleAttachments(item.Id, attachments, originalAttachmentIds, currentDateTime);

      return 1;
    });
  }

  /**
   * Move an item to "Recently Deleted" (trash).
   * @param itemId - The ID of the item to trash
   * @returns The number of rows updated
   */
  public async trash(itemId: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.client.executeUpdate(ItemQueries.TRASH_ITEM, [
        currentDateTime,
        currentDateTime,
        itemId
      ]);
    });
  }

  /**
   * Restore an item from "Recently Deleted".
   * @param itemId - The ID of the item to restore
   * @returns The number of rows updated
   */
  public async restore(itemId: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();
      return this.client.executeUpdate(ItemQueries.RESTORE_ITEM, [
        currentDateTime,
        itemId
      ]);
    });
  }

  /**
   * Permanently delete an item - converts to tombstone for sync.
   * @param itemId - The ID of the item to permanently delete
   * @returns The number of rows updated
   */
  public async permanentlyDelete(itemId: string): Promise<number> {
    return this.withTransaction(async () => {
      const currentDateTime = this.now();

      // Get the LogoId before we clear it
      const logoResult = this.client.executeQuery<{ LogoId: string | null }>(
        ItemQueries.GET_LOGO_ID,
        [itemId]
      );
      const logoId = logoResult.length > 0 ? logoResult[0].LogoId : null;

      // Hard delete all related entities
      this.hardDeleteByForeignKey('FieldValues', 'ItemId', itemId);
      this.hardDeleteByForeignKey('FieldHistories', 'ItemId', itemId);
      this.hardDeleteByForeignKey('Passkeys', 'ItemId', itemId);
      this.hardDeleteByForeignKey('TotpCodes', 'ItemId', itemId);
      this.hardDeleteByForeignKey('Attachments', 'ItemId', itemId);
      this.hardDeleteByForeignKey('ItemTags', 'ItemId', itemId);

      // Convert item to tombstone
      const result = this.client.executeUpdate(ItemQueries.TOMBSTONE_ITEM, [
        currentDateTime,
        itemId
      ]);

      // Clean up orphaned logo
      if (logoId) {
        this.logoRepository.cleanupOrphanedLogo(logoId);
      }

      return result;
    });
  }

  /**
   * Get all items in "Recently Deleted".
   * @returns Array of trashed Item objects with DeletedAt
   */
  public getRecentlyDeleted(): ItemWithDeletedAt[] {
    let itemRows: (ItemRow & { DeletedAt: string })[];
    try {
      // Need a modified query that includes DeletedAt in the SELECT
      const query = `
        SELECT DISTINCT
          i.Id,
          i.Name,
          i.ItemType,
          i.FolderId,
          f.Name as FolderPath,
          l.FileData as Logo,
          i.DeletedAt,
          CASE WHEN EXISTS (SELECT 1 FROM Passkeys pk WHERE pk.ItemId = i.Id AND pk.IsDeleted = 0) THEN 1 ELSE 0 END as HasPasskey,
          CASE WHEN EXISTS (SELECT 1 FROM Attachments att WHERE att.ItemId = i.Id AND att.IsDeleted = 0) THEN 1 ELSE 0 END as HasAttachment,
          CASE WHEN EXISTS (SELECT 1 FROM TotpCodes tc WHERE tc.ItemId = i.Id AND tc.IsDeleted = 0) THEN 1 ELSE 0 END as HasTotp,
          i.CreatedAt,
          i.UpdatedAt
        FROM Items i
        LEFT JOIN Logos l ON i.LogoId = l.Id
        LEFT JOIN Folders f ON i.FolderId = f.Id
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

    const itemIds = itemRows.map(i => i.Id);

    // Get all field values
    const fieldRows = this.client.executeQuery<FieldRow>(
      ItemQueries.getFieldValuesForItems(itemIds.length),
      itemIds
    );
    const fieldsByItem = FieldMapper.processFieldRows(fieldRows);

    return itemRows.map(row => ItemMapper.mapDeletedItemRow(row, fieldsByItem.get(row.Id) || []));
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
   * Get field history for a specific field.
   * @param itemId - The ID of the item
   * @param fieldKey - The field key to get history for
   * @returns Array of field history records
   */
  public getFieldHistory(itemId: string, fieldKey: string): FieldHistory[] {
    const results = this.client.executeQuery<{
      Id: string;
      ItemId: string;
      FieldKey: string;
      ValueSnapshot: string;
      ChangedAt: string;
      CreatedAt: string;
      UpdatedAt: string;
    }>(FieldHistoryQueries.GET_FOR_FIELD, [itemId, fieldKey, MAX_FIELD_HISTORY_RECORDS]);

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

  // ===== Private Helper Methods =====

  /**
   * Resolve the logo ID for an item (create new or reuse existing).
   */
  private resolveLogoId(item: Item, currentDateTime: string): string | null {
    const urlField = item.Fields?.find(f => f.FieldKey === 'login.url');
    const urlValue = urlField?.Value;
    const urlString = Array.isArray(urlValue) ? urlValue[0] : urlValue;
    const source = this.logoRepository.extractSourceFromUrl(urlString);

    if (item.Logo) {
      const logoData = this.logoRepository.convertLogoToUint8Array(item.Logo);
      if (logoData) {
        return this.logoRepository.getOrCreate(source, logoData, currentDateTime);
      }
    } else if (source !== 'unknown') {
      return this.logoRepository.getIdForSource(source);
    }

    return null;
  }

  /**
   * Insert field values for a new item.
   */
  private insertFieldValues(
    itemId: string,
    fields: ItemField[],
    itemType: string,
    currentDateTime: string
  ): void {
    for (const field of fields) {
      // Skip empty fields
      if (!field.Value || (typeof field.Value === 'string' && field.Value.trim() === '')) {
        continue;
      }

      let fieldDefinitionId = null;

      // For custom fields, create or get FieldDefinition
      if (field.IsCustomField) {
        fieldDefinitionId = this.ensureFieldDefinition(field, itemType, currentDateTime);
      }

      // Handle multi-value fields
      const values = Array.isArray(field.Value) ? field.Value : [field.Value];

      for (const value of values) {
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          continue;
        }

        this.client.executeUpdate(FieldValueQueries.INSERT, [
          this.generateId(),
          itemId,
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

  /**
   * Ensure a field definition exists for a custom field.
   */
  private ensureFieldDefinition(
    field: ItemField,
    itemType: string,
    currentDateTime: string
  ): string {
    const existingDef = this.client.executeQuery<{ Id: string }>(
      FieldDefinitionQueries.EXISTS,
      [field.FieldKey]
    );

    if (existingDef.length === 0) {
      this.client.executeUpdate(FieldDefinitionQueries.INSERT, [
        field.FieldKey,
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
  private updateFieldValues(item: Item, currentDateTime: string): void {
    // Get existing FieldValues
    const existingFieldValues = this.client.executeQuery<{
      Id: string;
      FieldKey: string | null;
      FieldDefinitionId: string | null;
      Value: string;
    }>(FieldValueQueries.GET_EXISTING_FOR_ITEM, [item.Id]);

    // Build a map of existing FieldValues by key:index
    const existingByKey = new Map<string, { Id: string; Value: string }>();
    const fieldValueCounts = new Map<string, number>();

    for (const fv of existingFieldValues) {
      const key = fv.FieldKey || fv.FieldDefinitionId || '';
      const count = fieldValueCounts.get(key) || 0;
      existingByKey.set(`${key}:${count}`, { Id: fv.Id, Value: fv.Value });
      fieldValueCounts.set(key, count + 1);
    }

    const processedIds = new Set<string>();

    // Update existing or insert new FieldValues
    if (item.Fields && item.Fields.length > 0) {
      for (const field of item.Fields) {
        if (!field.Value || (typeof field.Value === 'string' && field.Value.trim() === '')) {
          continue;
        }

        let fieldDefinitionId = null;

        if (field.IsCustomField) {
          fieldDefinitionId = this.ensureOrUpdateFieldDefinition(field, item.ItemType, currentDateTime);
        }

        const values = Array.isArray(field.Value) ? field.Value : [field.Value];
        const effectiveKey = field.FieldKey;

        for (let i = 0; i < values.length; i++) {
          const value = values[i];
          if (!value || (typeof value === 'string' && value.trim() === '')) {
            continue;
          }

          const lookupKey = `${effectiveKey}:${i}`;
          const existing = existingByKey.get(lookupKey);

          if (existing) {
            processedIds.add(existing.Id);
            if (existing.Value !== value) {
              this.client.executeUpdate(FieldValueQueries.UPDATE, [
                value,
                field.DisplayOrder ?? 0,
                currentDateTime,
                existing.Id
              ]);
            }
          } else {
            this.client.executeUpdate(FieldValueQueries.INSERT, [
              this.generateId(),
              item.Id,
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
        this.client.executeUpdate(FieldValueQueries.SOFT_DELETE, [currentDateTime, fv.Id]);
      }
    }
  }

  /**
   * Ensure a field definition exists and is up-to-date.
   */
  private ensureOrUpdateFieldDefinition(
    field: ItemField,
    itemType: string,
    currentDateTime: string
  ): string {
    const existingDef = this.client.executeQuery<{ Id: string }>(
      FieldDefinitionQueries.EXISTS_ACTIVE,
      [field.FieldKey]
    );

    if (existingDef.length === 0) {
      this.client.executeUpdate(FieldDefinitionQueries.INSERT, [
        field.FieldKey,
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
        field.FieldKey
      ]);
    }

    return field.FieldKey;
  }

  /**
   * Track field history for fields with EnableHistory=true.
   */
  private async trackFieldHistory(
    itemId: string,
    newFields: ItemField[],
    currentDateTime: string
  ): Promise<void> {
    const existingFields = this.client.executeQuery<{ FieldKey: string; Value: string }>(
      FieldValueQueries.GET_FOR_HISTORY,
      [itemId]
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

      const valuesChanged = oldValues.length !== newValues.length ||
        !oldValues.every((val, idx) => val === newValues[idx]);

      if (valuesChanged && oldValues.length > 0) {
        const historyId = this.generateId();
        const valueSnapshot = JSON.stringify(oldValues);

        this.client.executeUpdate(FieldHistoryQueries.INSERT, [
          historyId,
          itemId,
          null,
          newField.FieldKey,
          valueSnapshot,
          currentDateTime,
          currentDateTime,
          currentDateTime,
          0
        ]);

        await this.pruneFieldHistory(itemId, newField.FieldKey, currentDateTime);
      }
    }
  }

  /**
   * Prune old field history records.
   */
  private async pruneFieldHistory(
    itemId: string,
    fieldKey: string,
    currentDateTime: string
  ): Promise<void> {
    const matchingHistory = this.client.executeQuery<{ Id: string; ChangedAt: string }>(
      FieldHistoryQueries.GET_FOR_PRUNING,
      [itemId, fieldKey]
    );

    if (matchingHistory.length > MAX_FIELD_HISTORY_RECORDS) {
      const recordsToDelete = matchingHistory.slice(MAX_FIELD_HISTORY_RECORDS);
      const idsToDelete = recordsToDelete.map(r => r.Id);

      if (idsToDelete.length > 0) {
        this.client.executeUpdate(
          FieldHistoryQueries.softDeleteOld(idsToDelete.length),
          [currentDateTime, ...idsToDelete]
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
        `INSERT INTO TotpCodes (Id, Name, SecretKey, ItemId, CreatedAt, UpdatedAt, IsDeleted)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          totpCode.Id || this.generateId(),
          totpCode.Name,
          totpCode.SecretKey,
          itemId,
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
    totpCodes: TotpCode[],
    originalIds: string[],
    currentDateTime: string
  ): void {
    // Fetch existing TOTP codes to compare values
    const existingTotpCodes = this.client.executeQuery<{
      Id: string;
      Name: string;
      SecretKey: string;
    }>(`SELECT Id, Name, SecretKey FROM TotpCodes WHERE ItemId = ? AND IsDeleted = 0`, [itemId]);

    const existingByIdMap = new Map(existingTotpCodes.map(tc => [tc.Id, tc]));

    for (const totpCode of totpCodes) {
      const wasOriginal = originalIds.includes(totpCode.Id);

      if (totpCode.IsDeleted) {
        if (wasOriginal) {
          this.client.executeUpdate(
            `UPDATE TotpCodes SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?`,
            [currentDateTime, totpCode.Id]
          );
        }
      } else if (wasOriginal) {
        // Only update if values actually changed
        const existing = existingByIdMap.get(totpCode.Id);
        if (existing && (existing.Name !== totpCode.Name || existing.SecretKey !== totpCode.SecretKey)) {
          this.client.executeUpdate(
            `UPDATE TotpCodes SET Name = ?, SecretKey = ?, UpdatedAt = ? WHERE Id = ?`,
            [totpCode.Name, totpCode.SecretKey, currentDateTime, totpCode.Id]
          );
        }
      } else {
        this.client.executeUpdate(
          `INSERT INTO TotpCodes (Id, Name, SecretKey, ItemId, CreatedAt, UpdatedAt, IsDeleted)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            totpCode.Id || this.generateId(),
            totpCode.Name,
            totpCode.SecretKey,
            itemId,
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
        `INSERT INTO Attachments (Id, Filename, Blob, ItemId, CreatedAt, UpdatedAt, IsDeleted)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          attachment.Id || this.generateId(),
          attachment.Filename,
          blobData,
          itemId,
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
    attachments: Attachment[],
    originalIds: string[],
    currentDateTime: string
  ): void {
    for (const attachment of attachments) {
      const wasOriginal = originalIds.includes(attachment.Id);

      if (attachment.IsDeleted) {
        if (wasOriginal) {
          this.client.executeUpdate(
            `UPDATE Attachments SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?`,
            [currentDateTime, attachment.Id]
          );
        }
      } else if (!wasOriginal) {
        const blobData = attachment.Blob instanceof Uint8Array
          ? attachment.Blob
          : new Uint8Array(attachment.Blob);

        this.client.executeUpdate(
          `INSERT INTO Attachments (Id, Filename, Blob, ItemId, CreatedAt, UpdatedAt, IsDeleted)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            attachment.Id || this.generateId(),
            attachment.Filename,
            blobData,
            itemId,
            currentDateTime,
            currentDateTime,
            0
          ]
        );
      }
    }
  }
}
