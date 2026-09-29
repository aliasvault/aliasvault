import { FieldTypes, ItemTypes } from '@aliasvault/models/vault';

import type { Item, ItemField, ItemType } from '@aliasvault/models/vault';

/**
 * Filters for the items list: feature filters plus one per item type. The values appear as-is in route params.
 */
export const ItemFilter = {
  All: 'all',
  Passkeys: 'passkeys',
  Attachments: 'attachments',
  Totp: 'totp',
  Login: ItemTypes.Login,
  Alias: ItemTypes.Alias,
  CreditCard: ItemTypes.CreditCard,
  Note: ItemTypes.Note,
} as const;

/**
 * A filter value for the items list.
 */
export type ItemFilterType = typeof ItemFilter[keyof typeof ItemFilter];

/**
 * Check if a filter is an item type filter (Login, Alias, CreditCard, Note).
 */
export function isItemTypeFilter(filter: ItemFilterType): filter is ItemType {
  return Object.values(ItemTypes).includes(filter as ItemType);
}

/**
 * Parse a filter value from a URL/route param. Returns `ItemFilter.All` if the value is missing
 * or doesn't match a known filter, so an unexpected param can't break the screen.
 */
export function parseItemFilterType(value: string | null | undefined): ItemFilterType {
  if (!value) {
    return ItemFilter.All;
  }
  if (Object.values(ItemFilter).includes(value as ItemFilterType)) {
    return value as ItemFilterType;
  }
  return ItemFilter.All;
}

/**
 * The parts of an item a type/feature filter reads, so folder counts can run over item summaries.
 */
export type FilterableItem = Pick<Item, 'ItemType' | 'HasPasskey' | 'HasAttachment' | 'HasTotp'>;

/**
 * Apply the active type/feature filter to a list of items.
 * Used both for the visible item list and for computing folder badge counts so they
 * stay consistent when a filter is active, folder counts only include matching items.
 */
export function applyTypeFilter<T extends FilterableItem>(items: T[], filterType: ItemFilterType): T[] {
  if (filterType === ItemFilter.All) {
    return items;
  }

  return items.filter((item: T) => {
    if (filterType === ItemFilter.Passkeys) {
      return item.HasPasskey === true;
    }
    if (filterType === ItemFilter.Attachments) {
      return item.HasAttachment === true;
    }
    if (filterType === ItemFilter.Totp) {
      return item.HasTotp === true;
    }
    if (isItemTypeFilter(filterType)) {
      return item.ItemType === filterType;
    }
    return true;
  });
}

/**
 * Whether a field holds a secret (password, card number, CVV, PIN, hidden custom field) whose value search skips.
 */
const isSecretField = (field: ItemField): boolean => field.IsHidden || field.FieldType === FieldTypes.Password || field.FieldType === FieldTypes.Hidden;

/**
 * Apply the free-text search filter to a list of items.
 * Splits the term into words and keeps items where every word appears in the name,
 * a field value or a field label. Secret field values are never searched, so typing part
 * of a password cannot reveal which items hold it. Shared with the current-site suggestion
 * so the suggested match count always equals what the search field itself returns.
 */
export function applySearchFilter<T extends Pick<Item, 'Name' | 'Fields'>>(items: T[], searchTerm: string): T[] {
  const searchWords = searchTerm.toLowerCase().trim().split(/\s+/).filter(word => word.length > 0);

  if (searchWords.length === 0) {
    return items;
  }

  return items.filter((item) => {
    const searchableFields: string[] = [
      item.Name?.toLowerCase() ?? '',
    ];

    item.Fields?.forEach(field => {
      if (!isSecretField(field)) {
        const value = Array.isArray(field.Value) ? field.Value.join(' ') : (field.Value ?? '');
        searchableFields.push(value.toLowerCase());
      }
      searchableFields.push(field.Label?.toLowerCase() ?? '');
    });

    return searchWords.every(word =>
      searchableFields.some(field => field.includes(word))
    );
  });
}
