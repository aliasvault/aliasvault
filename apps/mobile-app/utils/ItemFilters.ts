import type { Item, ItemType } from './dist/core/models/vault';
import { ItemTypes } from './dist/core/models/vault';

/**
 * Filter types for the items list.
 * - 'all': Show all items
 * - 'passkeys': Show only items with passkeys
 * - 'attachments': Show only items with attachments
 * - 'totp': Show only items with 2FA codes
 * - ItemType values: Filter by specific item type (Login, Alias, CreditCard, Note)
 */
export type ItemFilterType = 'all' | 'passkeys' | 'attachments' | 'totp' | ItemType;

/**
 * Check if a filter is an item type filter (Login, Alias, CreditCard, Note).
 */
export function isItemTypeFilter(filter: ItemFilterType): filter is ItemType {
  return Object.values(ItemTypes).includes(filter as ItemType);
}

/**
 * Parse a filter value from a URL/route param. Returns 'all' if the value is missing
 * or doesn't match a known filter, so an unexpected param can't break the screen.
 */
export function parseItemFilterType(value: string | null | undefined): ItemFilterType {
  if (!value) {
    return 'all';
  }
  if (value === 'all' || value === 'passkeys' || value === 'attachments' || value === 'totp') {
    return value;
  }
  if (isItemTypeFilter(value as ItemFilterType)) {
    return value as ItemType;
  }
  return 'all';
}

/**
 * Apply the active type/feature filter to a list of items.
 * Used both for the visible item list and for computing folder badge counts so they
 * stay consistent — when a filter is active, folder counts only include matching items.
 */
export function applyTypeFilter(items: Item[], filterType: ItemFilterType): Item[] {
  if (filterType === 'all') {
    return items;
  }

  return items.filter((item: Item) => {
    if (filterType === 'passkeys') {
      return item.HasPasskey === true;
    }
    if (filterType === 'attachments') {
      return item.HasAttachment === true;
    }
    if (filterType === 'totp') {
      return item.HasTotp === true;
    }
    if (isItemTypeFilter(filterType)) {
      return item.ItemType === filterType;
    }
    return true;
  });
}
