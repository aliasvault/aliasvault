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
 * A character that is part of a word (letter, digit or combining mark).
 */
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/**
 * Scripts written without spaces between words (Han, kana, Thai, Lao, Myanmar, Khmer), where word starts cannot be detected.
 */
const NO_SPACE_SCRIPT_CHAR = /[\u0E00-\u0EFF\u1000-\u109F\u1780-\u17FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF66-\uFF9F\u{20000}-\u{3FFFF}]/u;

/**
 * Index of the first occurrence of `word` in `text` at the start of a word, or -1.
 * A word that starts with punctuation (".com", "@gmail") or with a script written without spaces may match anywhere.
 */
function wordStartIndex(text: string, word: string): number {
  const first = String.fromCodePoint(word.codePointAt(0) ?? 0);
  const anywhere = !WORD_CHAR.test(first) || NO_SPACE_SCRIPT_CHAR.test(first);

  let index = text.indexOf(word);
  while (index !== -1) {
    if (anywhere || index === 0 || !WORD_CHAR.test(Array.from(text.slice(Math.max(0, index - 2), index)).pop() ?? '')) {
      return index;
    }
    index = text.indexOf(word, index + 1);
  }
  return -1;
}

/**
 * Whether a search word matches `text`: at the start of a word, so "bank" matches "My Bank" and "bank.com" but not "Databank".
 * A `*` matches any characters, so a leading `*` drops the word-start rule ("*bank" matches "Databank").
 */
export function matchesSearchWord(text: string, word: string): boolean {
  if (!word.includes('*')) {
    return wordStartIndex(text, word) !== -1;
  }

  const parts = word.split('*').filter(part => part.length > 0);
  if (parts.length === 0) {
    return true;
  }

  const firstIndex = word.startsWith('*') ? text.indexOf(parts[0]) : wordStartIndex(text, parts[0]);
  if (firstIndex === -1) {
    return false;
  }

  let end = firstIndex + parts[0].length;
  for (const part of parts.slice(1)) {
    const index = text.indexOf(part, end);
    if (index === -1) {
      return false;
    }
    end = index + part.length;
  }
  return true;
}

/**
 * Apply the free-text search filter to a list of items.
 * Splits the term into words and keeps items where every word starts a word in the name,
 * a field value or a field label (see `matchesSearchWord`). Secret field values are never searched, so typing part
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

    return searchWords.every(word => searchableFields.some(field => matchesSearchWord(field, word)));
  });
}
