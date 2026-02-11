import type { Item, ItemField, TotpCode, Attachment, FieldHistory } from '@/utils/dist/core/models/vault';
import { FieldKey, MAX_FIELD_HISTORY_RECORDS } from '@/utils/dist/core/models/vault';

import { BaseRepository } from '../BaseRepository';
import { ItemQueries, FieldValueQueries, FieldDefinitionQueries, FieldHistoryQueries } from '../queries/ItemQueries';
import { FieldMapper, type FieldRow } from '../mappers/FieldMapper';
import { ItemMapper, type ItemRow, type TagRow, type ItemWithDeletedAt } from '../mappers/ItemMapper';
import type { LogoRepository } from './LogoRepository';

/**
 * SQL query constants for Item-related tag operations.
 */
const TagQueries = {
  /**
   * Get tags for multiple items.
   */
  GET_TAGS_FOR_ITEMS: (itemCount: number): string => {
    const placeholders = Array(itemCount).fill('?').join(',');
    return `
      SELECT it.ItemId, t.Id, t.Name, t.Color
      FROM ItemTags it
      INNER JOIN Tags t ON it.TagId = t.Id
      WHERE it.ItemId IN (${placeholders})
        AND it.IsDeleted = 0
        AND t.IsDeleted = 0
      ORDER BY t.DisplayOrder`;
  },

  /**
   * Get tags for a single item.
   */
  GET_TAGS_FOR_ITEM: `
    SELECT t.Id, t.Name, t.Color
    FROM ItemTags it
    INNER JOIN Tags t ON it.TagId = t.Id
    WHERE it.ItemId = ?
      AND it.IsDeleted = 0
      AND t.IsDeleted = 0
    ORDER BY t.DisplayOrder`
};

/**
 * Repository for Item CRUD operations.
 * Handles fetching, creating, updating, and deleting items with their related data.
 */
export class ItemRepository extends BaseRepository {
  private logoRepository: LogoRepository | null = null;

  /**
   * Set the logo repository for logo handling operations.
   * @param logoRepository - The logo repository instance
   */
  public setLogoRepository(logoRepository: LogoRepository): void {
    this.logoRepository = logoRepository;
  }
  /**
   * Fetch all active items (not deleted, not in trash) with their fields and tags.
   * @returns Array of Item objects
   */
  public async getAll(): Promise<Item[]> {
    // 1. Fetch all item rows
    const itemRows = await this.client.executeQuery<ItemRow>(ItemQueries.GET_ALL_ACTIVE);

    if (itemRows.length === 0) {
      return [];
    }

    // 2. Fetch field values for all items
    const itemIds = itemRows.map(row => row.Id);
    const fieldQuery = ItemQueries.getFieldValuesForItems(itemIds.length);
    const fieldRows = await this.client.executeQuery<FieldRow>(fieldQuery, itemIds);

    // 3. Process fields into a map by ItemId
    const fieldsByItem = FieldMapper.processFieldRows(fieldRows);

    // 4. Fetch tags for all items
    let tagsByItem = new Map<string, { Id: string; Name: string; Color?: string }[]>();
    if (await this.tableExists('ItemTags')) {
      const tagQuery = TagQueries.GET_TAGS_FOR_ITEMS(itemIds.length);
      const tagRows = await this.client.executeQuery<TagRow>(tagQuery, itemIds);
      tagsByItem = ItemMapper.groupTagsByItem(tagRows);
    }

    // 5. Map rows to Item objects
    return ItemMapper.mapRows(itemRows, fieldsByItem, tagsByItem);
  }

  /**
   * Fetch a single item by ID with its fields and tags.
   * @param itemId - The ID of the item to fetch
   * @returns Item object or null if not found
   */
  public async getById(itemId: string): Promise<Item | null> {
    // 1. Fetch item row
    const itemRows = await this.client.executeQuery<ItemRow>(ItemQueries.GET_BY_ID, [itemId]);

    if (itemRows.length === 0) {
      return null;
    }

    const itemRow = itemRows[0];

    // 2. Fetch field values
    const fieldRows = await this.client.executeQuery<Omit<FieldRow, 'ItemId'>>(
      ItemQueries.GET_FIELD_VALUES_FOR_ITEM,
      [itemId]
    );
    const fields = FieldMapper.processFieldRowsForSingleItem(fieldRows);

    // 3. Fetch tags
    let tags: { Id: string; Name: string; Color?: string }[] = [];
    if (await this.tableExists('ItemTags')) {
      const tagRows = await this.client.executeQuery<Omit<TagRow, 'ItemId'>>(
        TagQueries.GET_TAGS_FOR_ITEM,
        [itemId]
      );
      tags = ItemMapper.mapTagRows(tagRows);
    }

    // 4. Map to Item object
    return ItemMapper.mapRow(itemRow, fields, tags);
  }

  /**
   * Fetch all unique email addresses from field values.
   * @returns Array of email addresses
   */
  public async getAllEmailAddresses(): Promise<string[]> {
    const results = await this.client.executeQuery<{ Email: string }>(
      ItemQueries.GET_ALL_EMAIL_ADDRESSES,
      [FieldKey.LoginEmail]
    );
    return results.map(row => row.Email);
  }

  /**
   * Fetch an item by its email address (case-insensitive).
   * @param email - The email address to search for
   * @returns Item object or null if not found
   */
  public async getByEmail(email: string): Promise<Item | null> {
    // 1. Fetch item row by email
    const itemRows = await this.client.executeQuery<ItemRow>(
      ItemQueries.GET_BY_EMAIL,
      [email, FieldKey.LoginEmail]
    );

    if (itemRows.length === 0) {
      return null;
    }

    const itemRow = itemRows[0];

    // 2. Fetch field values
    const fieldRows = await this.client.executeQuery<Omit<FieldRow, 'ItemId'>>(
      ItemQueries.GET_FIELD_VALUES_FOR_ITEM,
      [itemRow.Id]
    );
    const fields = FieldMapper.processFieldRowsForSingleItem(fieldRows);

    // 3. Map to Item object
    return ItemMapper.mapRow(itemRow, fields, []);
  }

  /**
   * Get recently deleted items (in trash).
   * @returns Array of items with DeletedAt field
   */
  public async getRecentlyDeleted(): Promise<ItemWithDeletedAt[]> {
    const itemRows = await this.client.executeQuery<ItemRow & { DeletedAt: string }>(
      ItemQueries.GET_RECENTLY_DELETED
    );

    if (itemRows.length === 0) {
      return [];
    }

    // Fetch fields for deleted items
    const itemIds = itemRows.map(row => row.Id);
    const fieldQuery = ItemQueries.getFieldValuesForItems(itemIds.length);
    const fieldRows = await this.client.executeQuery<FieldRow>(fieldQuery, itemIds);
    const fieldsByItem = FieldMapper.processFieldRows(fieldRows);

    return itemRows.map(row => ItemMapper.mapDeletedItemRow(row, fieldsByItem.get(row.Id) || []));
  }

  /**
   * Get count of items in trash.
   * @returns Number of items in trash
   */
  public async getRecentlyDeletedCount(): Promise<number> {
    const results = await this.client.executeQuery<{ count: number }>(ItemQueries.COUNT_RECENTLY_DELETED);
    return results.length > 0 ? results[0].count : 0;
  }

  /**
   * Get field history for a specific field.
   * @param itemId - The ID of the item
   * @param fieldKey - The field key to get history for
   * @returns Array of field history records
   */
  public async getFieldHistory(itemId: string, fieldKey: string): Promise<FieldHistory[]> {
    const results = await this.client.executeQuery<{
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

  /**
   * Delete a specific field history record.
   * @param historyId - The ID of the history record to delete
   * @returns Number of rows affected
   */
  public async deleteFieldHistory(historyId: string): Promise<number> {
    return this.withTransaction(async () => {
      const now = this.now();
      return this.client.executeUpdate(FieldHistoryQueries.SOFT_DELETE, [
        now,
        historyId
      ]);
    });
  }

  /**
   * Move an item to trash (set DeletedAt timestamp).
   * @param itemId - The ID of the item to trash
   * @returns Number of rows affected
   */
  public async trash(itemId: string): Promise<number> {
    const now = this.now();
    return this.withTransaction(async () => {
      return this.client.executeUpdate(ItemQueries.TRASH_ITEM, [now, now, itemId]);
    });
  }

  /**
   * Restore an item from trash (clear DeletedAt).
   * @param itemId - The ID of the item to restore
   * @returns Number of rows affected
   */
  public async restore(itemId: string): Promise<number> {
    const now = this.now();
    return this.withTransaction(async () => {
      return this.client.executeUpdate(ItemQueries.RESTORE_ITEM, [now, itemId]);
    });
  }

  /**
   * Permanently delete an item (tombstone).
   * Converts item to tombstone and hard deletes all related data.
   * @param itemId - The ID of the item to permanently delete
   * @returns Number of rows affected
   */
  public async permanentlyDelete(itemId: string): Promise<number> {
    return this.withTransaction(async () => {
      const now = this.now();

      // Soft delete related FieldValues
      await this.softDeleteByForeignKey('FieldValues', 'ItemId', itemId);

      // Soft delete related data
      await this.softDeleteByForeignKey('TotpCodes', 'ItemId', itemId);
      await this.softDeleteByForeignKey('Attachments', 'ItemId', itemId);
      await this.softDeleteByForeignKey('Passkeys', 'ItemId', itemId);
      if (await this.tableExists('ItemTags')) {
        await this.softDeleteByForeignKey('ItemTags', 'ItemId', itemId);
      }
      if (await this.tableExists('FieldHistories')) {
        await this.softDeleteByForeignKey('FieldHistories', 'ItemId', itemId);
      }

      // Convert item to tombstone
      return this.client.executeUpdate(ItemQueries.TOMBSTONE_ITEM, [now, itemId]);
    });
  }

  /**
   * Create a new item with its fields and related entities.
   * @param item - The item to create
   * @param attachments - Array of attachments to create
   * @param totpCodes - Array of TOTP codes to create
   * @param logoRepository - Optional logo repository for logo handling
   * @returns The ID of the created item
   */
  public async create(
    item: Item,
    attachments: Attachment[] = [],
    totpCodes: TotpCode[] = []
  ): Promise<string> {
    return this.withTransaction(async () => {
      const now = this.now();
      const itemId = item.Id || this.generateId();

      // 1. Insert Item
      await this.client.executeUpdate(ItemQueries.INSERT_ITEM, [
        itemId,
        item.Name,
        item.ItemType,
        null, // LogoId - handled separately if needed
        item.FolderId || null,
        now,
        now,
        0
      ]);

      // 2. Insert FieldValues
      await this.insertFieldValues(itemId, item.Fields, item.ItemType, now);

      // 3. Insert TOTP codes
      for (const totp of totpCodes) {
        if (totp.IsDeleted) continue;

        await this.client.executeUpdate(`
          INSERT INTO TotpCodes (Id, Name, SecretKey, ItemId, CreatedAt, UpdatedAt, IsDeleted)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [totp.Id || this.generateId(), totp.Name, totp.SecretKey, itemId, now, now, 0]);
      }

      // 4. Insert Attachments
      for (const attachment of attachments) {
        await this.client.executeUpdate(`
          INSERT INTO Attachments (Id, Filename, Blob, ItemId, CreatedAt, UpdatedAt, IsDeleted)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [attachment.Id, attachment.Filename, attachment.Blob as Uint8Array, itemId, now, now, 0]);
      }

      return itemId;
    });
  }

  /**
   * Update an existing item with its fields and related entities.
   * @param item - The item to update
   * @param originalAttachmentIds - IDs of attachments that existed before edit
   * @param attachments - Current attachments (new and existing)
   * @param originalTotpCodeIds - IDs of TOTP codes that existed before edit
   * @param totpCodes - Current TOTP codes (new and existing)
   * @returns Number of rows affected
   */
  public async update(
    item: Item,
    originalAttachmentIds: string[] = [],
    attachments: Attachment[] = [],
    originalTotpCodeIds: string[] = [],
    totpCodes: TotpCode[] = []
  ): Promise<number> {
    return this.withTransaction(async () => {
      const now = this.now();

      // 1. Handle Logo - resolve new logoId based on item.Logo
      const logoId = await this.resolveLogoId(item, now);

      // 2. Update Item only if item-level fields changed
      const existing = await this.client.executeQuery<{
        Name: string | null;
        ItemType: string | null;
        FolderId: string | null;
        LogoId: string | null;
      }>(`SELECT Name, ItemType, FolderId, LogoId FROM Items WHERE Id = ?`, [item.Id]);

      if (existing.length > 0) {
        const existingItem = existing[0];
        const nameChanged = item.Name !== existingItem.Name;
        const itemTypeChanged = String(item.ItemType) !== String(existingItem.ItemType);
        const folderIdChanged = (item.FolderId || null) !== existingItem.FolderId;
        // Logo changed if: we have a new logo ID, OR we're clearing the logo (item.Logo is undefined and existing has logo)
        const logoIdChanged = logoId !== existingItem.LogoId;

        if (nameChanged || itemTypeChanged || folderIdChanged || logoIdChanged) {
          // Use UPDATE_ITEM_WITH_LOGO to allow explicit clearing of LogoId
          await this.client.executeUpdate(ItemQueries.UPDATE_ITEM_WITH_LOGO, [
            item.Name,
            item.ItemType,
            item.FolderId || null,
            logoId,
            now,
            item.Id
          ]);
        }
      }

      // 2. Track history for fields that have EnableHistory=true before updating
      await this.trackFieldHistory(item.Id, item.Fields, now);

      // 3. Update FieldValues using preserve-and-track strategy
      await this.updateFieldValues(item.Id, item.Fields, item.ItemType, now);

      // 4. Handle TOTP codes
      await this.syncRelatedEntities(
        'TotpCodes',
        'ItemId',
        item.Id,
        originalTotpCodeIds,
        totpCodes.filter(tc => !tc.IsDeleted),
        (totp) => [totp.Id || this.generateId(), totp.Name, totp.SecretKey, item.Id, now, now, 0],
        `INSERT INTO TotpCodes (Id, Name, SecretKey, ItemId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      // 5. Handle Attachments
      await this.syncRelatedEntities(
        'Attachments',
        'ItemId',
        item.Id,
        originalAttachmentIds,
        attachments,
        (att) => [att.Id, att.Filename, att.Blob as Uint8Array, item.Id, now, now, 0],
        `INSERT INTO Attachments (Id, Filename, Blob, ItemId, CreatedAt, UpdatedAt, IsDeleted) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      return 1;
    });
  }

  /**
   * Insert field values for an item.
   * Also creates history records for fields with EnableHistory=true.
   */
  private async insertFieldValues(itemId: string, fields: ItemField[], itemType: string, now: string): Promise<void> {
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const values = Array.isArray(field.Value) ? field.Value : [field.Value];
      const filteredValues = values.filter(v => v !== undefined && v !== null && v !== '');

      // Skip empty system fields, but always persist custom fields (even if empty)
      if (filteredValues.length === 0 && !field.IsCustomField) {
        continue;
      }

      // For custom fields with no values, use empty string to preserve the field
      const valuesToInsert = field.IsCustomField && filteredValues.length === 0
        ? ['']
        : filteredValues;

      let fieldDefinitionId: string | null = null;

      // For custom fields, create or get FieldDefinition first
      if (field.IsCustomField) {
        fieldDefinitionId = await this.ensureFieldDefinition(field, itemType, now);
      }

      for (let j = 0; j < valuesToInsert.length; j++) {
        const value = valuesToInsert[j];

        await this.client.executeUpdate(FieldValueQueries.INSERT, [
          this.generateId(),
          itemId,
          fieldDefinitionId, // FieldDefinitionId for custom, null for system
          field.IsCustomField ? null : field.FieldKey, // FieldKey for system, null for custom
          value,
          (i * 100) + j, // Weight for ordering
          now,
          now,
          0
        ]);
      }

      // Create history record for fields with EnableHistory=true
      if (field.EnableHistory && filteredValues.length > 0) {
        // Check if FieldHistories table exists
        if (await this.tableExists('FieldHistories')) {
          const historyId = this.generateId();
          const valueSnapshot = JSON.stringify(filteredValues);

          await this.client.executeUpdate(FieldHistoryQueries.INSERT, [
            historyId,
            itemId,
            null,
            field.FieldKey,
            valueSnapshot,
            now,
            now,
            now,
            0
          ]);
        }
      }
    }
  }

  /**
   * Ensure a field definition exists for a custom field.
   * Creates the definition if it doesn't exist.
   * @returns The field definition ID (which is the field's FieldKey/tempId)
   */
  private async ensureFieldDefinition(
    field: ItemField,
    itemType: string,
    currentDateTime: string
  ): Promise<string> {
    const existingDef = await this.client.executeQuery<{ Id: string }>(
      FieldDefinitionQueries.EXISTS,
      [field.FieldKey]
    );

    if (existingDef.length === 0) {
      await this.client.executeUpdate(FieldDefinitionQueries.INSERT, [
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
   * Ensure a field definition exists and is up-to-date.
   * Creates the definition if it doesn't exist, or updates it if it does.
   * @returns The field definition ID (which is the field's FieldKey/tempId)
   */
  private async ensureOrUpdateFieldDefinition(
    field: ItemField,
    itemType: string,
    currentDateTime: string
  ): Promise<string> {
    const existingDef = await this.client.executeQuery<{ Id: string }>(
      FieldDefinitionQueries.EXISTS_ACTIVE,
      [field.FieldKey]
    );

    if (existingDef.length === 0) {
      await this.client.executeUpdate(FieldDefinitionQueries.INSERT, [
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
    } else {
      // Update existing field definition (label, type, etc. may have changed)
      await this.client.executeUpdate(FieldDefinitionQueries.UPDATE, [
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
   * Update field values using preserve-and-track strategy.
   * Preserves existing field value IDs when possible for stable merge behavior.
   */
  private async updateFieldValues(itemId: string, fields: ItemField[], itemType: string, now: string): Promise<void> {
    // 1. Get existing field values
    const existingFields = await this.client.executeQuery<{
      Id: string;
      FieldKey: string | null;
      FieldDefinitionId: string | null;
      Value: string;
      Weight: number;
    }>(FieldValueQueries.GET_EXISTING_FOR_ITEM, [itemId]);

    // 2. Build lookup by composite key (FieldKey or FieldDefinitionId + index)
    const existingByKey = new Map<string, { Id: string; Value: string; Weight: number }[]>();
    for (const existing of existingFields) {
      const key = existing.FieldKey || existing.FieldDefinitionId || '';
      if (!existingByKey.has(key)) {
        existingByKey.set(key, []);
      }
      existingByKey.get(key)!.push({ Id: existing.Id, Value: existing.Value, Weight: existing.Weight });
    }

    // 3. Track which existing IDs we've processed
    const processedIds = new Set<string>();

    // 4. Process each field
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      const values = Array.isArray(field.Value) ? field.Value : [field.Value];
      const existingForKey = existingByKey.get(field.FieldKey) || [];

      // Skip empty system fields, but always persist custom fields (even if empty)
      const filteredValues = values.filter(v => v !== undefined && v !== null && v !== '');
      if (filteredValues.length === 0 && !field.IsCustomField) {
        continue;
      }

      // For custom fields with no values, use empty string to preserve the field
      const valuesToProcess = field.IsCustomField && filteredValues.length === 0
        ? ['']
        : filteredValues;

      let fieldDefinitionId: string | null = null;

      // For custom fields, ensure FieldDefinition exists and is up-to-date
      if (field.IsCustomField) {
        fieldDefinitionId = await this.ensureOrUpdateFieldDefinition(field, itemType, now);
      }

      for (let j = 0; j < valuesToProcess.length; j++) {
        const value = valuesToProcess[j];
        const newWeight = field.DisplayOrder ?? 0;

        const existingEntry = existingForKey[j];

        if (existingEntry) {
          // Update existing if value or weight changed
          processedIds.add(existingEntry.Id);
          if (existingEntry.Value !== value || existingEntry.Weight !== newWeight) {
            await this.client.executeUpdate(FieldValueQueries.UPDATE, [
              value,
              newWeight,
              now,
              existingEntry.Id
            ]);
          }
        } else {
          // Insert new field value
          await this.client.executeUpdate(FieldValueQueries.INSERT, [
            this.generateId(),
            itemId,
            fieldDefinitionId, // FieldDefinitionId for custom, null for system
            field.IsCustomField ? null : field.FieldKey, // FieldKey for system, null for custom
            value,
            newWeight,
            now,
            now,
            0
          ]);
        }
      }
    }

    // 5. Soft delete removed fields
    for (const existing of existingFields) {
      if (!processedIds.has(existing.Id)) {
        await this.client.executeUpdate(FieldValueQueries.SOFT_DELETE, [now, existing.Id]);
      }
    }
  }

  /**
   * Sync related entities (TOTP codes, attachments) with insert/delete tracking.
   */
  private async syncRelatedEntities<T extends { Id: string }>(
    tableName: string,
    foreignKey: string,
    foreignKeyValue: string,
    originalIds: string[],
    currentEntities: T[],
    toParams: (entity: T) => (string | number | null | Uint8Array)[],
    insertQuery: string
  ): Promise<void> {
    const now = this.now();
    const currentIds = currentEntities.map(e => e.Id);

    // Delete entities that were removed
    const toDelete = originalIds.filter(id => !currentIds.includes(id));
    for (const id of toDelete) {
      await this.client.executeUpdate(
        `UPDATE ${tableName} SET IsDeleted = 1, UpdatedAt = ? WHERE Id = ?`,
        [now, id]
      );
    }

    // Insert new entities
    for (const entity of currentEntities) {
      if (!originalIds.includes(entity.Id)) {
        await this.client.executeUpdate(insertQuery, toParams(entity));
      }
    }
  }

  /**
   * Track field history for fields with EnableHistory=true.
   * Compares old values with new values and creates history records.
   *
   * This saves the NEW value to history on every change. Since each value is saved
   * when it's set, we don't need to save the old value (it was already saved when
   * it was first set). This ensures that during merge conflicts, no values are ever
   * lost since history records sync independently via LWW and each has a unique ID.
   */
  private async trackFieldHistory(
    itemId: string,
    newFields: ItemField[],
    currentDateTime: string
  ): Promise<void> {
    // Check if FieldHistories table exists
    if (!(await this.tableExists('FieldHistories'))) {
      return;
    }

    const existingFields = await this.client.executeQuery<{ FieldKey: string; Value: string }>(
      FieldHistoryQueries.GET_FOR_HISTORY,
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

      // Filter out empty values for comparison
      const filteredNewValues = newValues.filter(v => v && v.trim() !== '');

      const valuesChanged = oldValues.length !== filteredNewValues.length ||
        !oldValues.every((val, idx) => val === filteredNewValues[idx]);

      // Save new values to history when they change (ensures they survive merge conflicts)
      if (valuesChanged && filteredNewValues.length > 0) {
        const historyId = this.generateId();
        const valueSnapshot = JSON.stringify(filteredNewValues);

        await this.client.executeUpdate(FieldHistoryQueries.INSERT, [
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
   * Keeps only the most recent MAX_FIELD_HISTORY_RECORDS records.
   */
  private async pruneFieldHistory(
    itemId: string,
    fieldKey: string,
    currentDateTime: string
  ): Promise<void> {
    const matchingHistory = await this.client.executeQuery<{ Id: string; ChangedAt: string }>(
      FieldHistoryQueries.GET_FOR_PRUNING,
      [itemId, fieldKey]
    );

    if (matchingHistory.length > MAX_FIELD_HISTORY_RECORDS) {
      const recordsToDelete = matchingHistory.slice(MAX_FIELD_HISTORY_RECORDS);
      const idsToDelete = recordsToDelete.map(r => r.Id);

      if (idsToDelete.length > 0) {
        await this.client.executeUpdate(
          FieldHistoryQueries.softDeleteOld(idsToDelete.length),
          [currentDateTime, ...idsToDelete]
        );
      }
    }
  }

  /**
   * Resolve the logo ID for an item (create new or reuse existing).
   * If item.Logo is undefined, returns null to clear any existing logo.
   * @param item - The item to resolve logo for
   * @param currentDateTime - The current timestamp
   * @returns The logo ID, or null if no logo
   */
  private async resolveLogoId(item: Item, currentDateTime: string): Promise<string | null> {
    // If no logo repository is set, we can't handle logos
    if (!this.logoRepository) {
      return null;
    }

    // Get URL field for source extraction
    const urlField = item.Fields?.find(f => f.FieldKey === 'login.url');
    const urlValue = urlField?.Value;
    const urlString = Array.isArray(urlValue) ? urlValue[0] : urlValue;
    const source = this.logoRepository.extractSourceFromUrl(urlString);

    // If item has Logo data, create or reuse a logo entry
    if (item.Logo) {
      const logoData = this.logoRepository.convertLogoToUint8Array(item.Logo);
      if (logoData) {
        return this.logoRepository.getOrCreate(source, logoData, currentDateTime);
      }
    } else if (source !== 'unknown') {
      // No logo data provided, but we have a valid URL - try to find existing logo for this source
      return this.logoRepository.getIdForSource(source);
    }

    // No logo data and no valid URL - return null to clear any existing logo
    return null;
  }
}
