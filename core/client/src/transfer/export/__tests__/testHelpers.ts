import { AvuxExportService } from '../AvuxExportService';

import type { FieldDefinitionEntity, FieldValueEntity, ItemEntity, LogoEntity } from '../../shared/VaultEntities';
import type { ItemType } from '@aliasvault/models/vault';

/*
 * Item builders for the export tests.
 */

/**
 * Decode CSV bytes as text.
 * @param bytes - The bytes
 * @returns The text
 */
export function csvText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Build a test item.
 * @param name - The item name
 * @param itemType - The item type
 * @param fields - System field values by key
 * @returns The item
 */
export function createTestItem(name: string, itemType: ItemType, fields: Record<string, string>): ItemEntity {
  const now = new Date();
  const item: ItemEntity = {
    Id: crypto.randomUUID(),
    Name: name,
    ItemType: itemType,
    FolderId: null,
    LogoId: null,
    CreatedAt: now,
    UpdatedAt: now,
    IsDeleted: false,
    FieldValues: [],
    Attachments: [],
    TotpCodes: [],
    Passkeys: [],
  };
  for (const [key, value] of Object.entries(fields)) {
    addFieldValue(item, key, value);
  }
  return item;
}

/**
 * Add a system field value to an item.
 * @param item - The item
 * @param fieldKey - The field key
 * @param value - The value
 * @param weight - The weight, for multi-value fields
 */
export function addFieldValue(item: ItemEntity, fieldKey: string, value: string, weight: number = 0): void {
  const fieldValue: FieldValueEntity = {
    Id: crypto.randomUUID(),
    ItemId: item.Id,
    FieldKey: fieldKey,
    FieldDefinitionId: null,
    Value: value,
    Weight: weight,
    CreatedAt: item.CreatedAt,
    UpdatedAt: item.UpdatedAt,
    IsDeleted: false,
  };
  item.FieldValues.push(fieldValue);
}

/**
 * Add a custom field value to an item.
 * @param item - The item
 * @param definition - The custom field definition
 * @param value - The value
 */
export function addCustomFieldValue(item: ItemEntity, definition: FieldDefinitionEntity, value: string): void {
  item.FieldValues.push({
    Id: crypto.randomUUID(),
    ItemId: item.Id,
    FieldDefinition: definition,
    FieldDefinitionId: definition.Id,
    FieldKey: null,
    Value: value,
    Weight: 0,
    CreatedAt: item.CreatedAt,
    UpdatedAt: item.UpdatedAt,
    IsDeleted: false,
  });
}

/**
 * Add a TOTP code to an item.
 * @param item - The item
 * @param secretKey - The Base32 secret
 */
export function addTotpCode(item: ItemEntity, secretKey: string): void {
  item.TotpCodes.push({ Id: crypto.randomUUID(), ItemId: item.Id, Name: 'Test TOTP', SecretKey: secretKey, Algorithm: 'SHA1', Digits: 6, Period: 30, CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt, IsDeleted: false });
}

/**
 * Add an attachment to an item.
 * @param item - The item
 * @param filename - The file name
 * @param content - The file content as text
 */
export function addAttachment(item: ItemEntity, filename: string, content: string): void {
  item.Attachments.push({ Id: crypto.randomUUID(), ItemId: item.Id, Filename: filename, Blob: new TextEncoder().encode(content), CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt, IsDeleted: false });
}

/**
 * Export with no folders, tags or definitions.
 * @param items - The items
 * @param logos - The logos
 * @param fieldDefinitions - The custom field definitions
 * @returns The .avux bytes
 */
export function exportItems(items: ItemEntity[], logos: LogoEntity[] = [], fieldDefinitions: FieldDefinitionEntity[] = []): Uint8Array {
  return AvuxExportService.exportToAvux(items, [], [], [], fieldDefinitions, logos, 'test@example.com');
}
