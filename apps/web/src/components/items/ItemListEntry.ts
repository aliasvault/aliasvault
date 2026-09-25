/**
 * Item list entry model for the item lists (the Blazor ItemListEntry), built from the vault's items.
 */

import SqliteClient from '@aliasvault/client/database/SqliteClient';
import { FieldKey, type Item, type ItemType } from '@aliasvault/models/vault';

/**
 * One item as the lists show it.
 */
export type ItemListEntry = {
  id: string;
  manifestId: string;
  itemType: ItemType;
  logoDataUri: string | null;
  service: string | null;
  username: string | null;
  email: string | null;
  cardNumber: string | null;
  createdAt: Date;
  hasPasskey: boolean;
  hasAttachment: boolean;
  hasTotp: boolean;
  folderId: string | null;
  item: Item;
};

/**
 * The first value of a field.
 * @param item - the item
 * @param fieldKey - the field key
 */
export function getFieldValue(item: Item, fieldKey: string): string | null {
  const field = item.Fields?.find(f => f.FieldKey === fieldKey);
  if (!field || !field.Value) {
    return null;
  }
  const value = Array.isArray(field.Value) ? field.Value[0] : field.Value;
  return value && value.length > 0 ? value : null;
}

/**
 * Map a vault item to a list entry.
 * @param item - the item
 */
export function toItemListEntry(item: Item): ItemListEntry {
  return {
    id: item.Id,
    manifestId: item.ManifestId,
    itemType: item.ItemType,
    logoDataUri: item.Logo ? SqliteClient.imgSrcFromBytes(item.Logo) : null,
    service: item.Name,
    username: getFieldValue(item, FieldKey.LoginUsername),
    email: getFieldValue(item, FieldKey.LoginEmail),
    cardNumber: getFieldValue(item, FieldKey.CardNumber),
    createdAt: new Date(item.CreatedAt),
    hasPasskey: item.HasPasskey ?? false,
    hasAttachment: item.HasAttachment ?? false,
    hasTotp: item.HasTotp ?? false,
    folderId: item.FolderId ?? null,
    item,
  };
}
