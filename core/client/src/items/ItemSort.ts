import { CredentialSortOrder } from '../database/repositories/SettingsRepository';
import { fromStandardFormat } from '../utilities/DateHelpers';

import type { Item } from '@aliasvault/models/vault';

/**
 * The parts of an item the sort orders read.
 */
export type SortableItem = Pick<Item, 'Name' | 'CreatedAt' | 'LastChangedAt' | 'LastUsedAt'>;

/**
 * What the items list sorts on: the last use, the last change, the creation, or the name.
 */
export type ItemSortField = 'lastUsed' | 'lastModified' | 'created' | 'name';

/**
 * The direction of a sort: ascending is oldest or A first.
 */
export type ItemSortDirection = 'asc' | 'desc';

/**
 * The sort fields of the items list menu, in menu order, with their translation keys and the direction a first pick sorts in.
 */
export const ITEM_SORT_FIELDS: { field: ItemSortField; labelKey: string; defaultDirection: ItemSortDirection }[] = [
  { field: 'lastUsed', labelKey: 'items.sort.lastUsed', defaultDirection: 'desc' },
  { field: 'lastModified', labelKey: 'items.sort.lastModified', defaultDirection: 'desc' },
  { field: 'created', labelKey: 'items.sort.dateCreated', defaultDirection: 'desc' },
  { field: 'name', labelKey: 'items.sort.name', defaultDirection: 'asc' },
];

/** The field and direction of each stored sort order. */
const SORT_ORDER_PARTS: Record<CredentialSortOrder, { field: ItemSortField; direction: ItemSortDirection }> = {
  [CredentialSortOrder.RecentlyUsedFirst]: { field: 'lastUsed', direction: 'desc' },
  [CredentialSortOrder.RecentlyUsedLast]: { field: 'lastUsed', direction: 'asc' },
  [CredentialSortOrder.RecentlyModifiedFirst]: { field: 'lastModified', direction: 'desc' },
  [CredentialSortOrder.RecentlyModifiedLast]: { field: 'lastModified', direction: 'asc' },
  [CredentialSortOrder.NewestFirst]: { field: 'created', direction: 'desc' },
  [CredentialSortOrder.OldestFirst]: { field: 'created', direction: 'asc' },
  [CredentialSortOrder.Alphabetical]: { field: 'name', direction: 'asc' },
  [CredentialSortOrder.ReverseAlphabetical]: { field: 'name', direction: 'desc' },
};

/**
 * The date groups of the last used and last modified sorts, newest first, with their translation keys.
 * Only an item that was never used has no date, and goes in the "never" group.
 */
export const RECENCY_GROUPS = {
  today: 'items.sort.groups.today',
  last7Days: 'items.sort.groups.last7Days',
  last30Days: 'items.sort.groups.last30Days',
  older: 'items.sort.groups.older',
  never: 'common.never',
} as const;

/**
 * A date group of the last used and last modified sorts.
 */
export type RecencyGroup = keyof typeof RECENCY_GROUPS;

/**
 * The field and direction of a sort order.
 * @param order - The sort order
 * @returns Its field and direction
 */
export function sortOrderParts(order: CredentialSortOrder): { field: ItemSortField; direction: ItemSortDirection } {
  return SORT_ORDER_PARTS[order] ?? SORT_ORDER_PARTS[CredentialSortOrder.NewestFirst];
}

/**
 * The sort order of a field and direction.
 * @param field - The sort field
 * @param direction - The direction
 * @returns The sort order
 */
export function toSortOrder(field: ItemSortField, direction: ItemSortDirection): CredentialSortOrder {
  const match = (Object.keys(SORT_ORDER_PARTS) as CredentialSortOrder[]).find(order => SORT_ORDER_PARTS[order].field === field && SORT_ORDER_PARTS[order].direction === direction);
  return match ?? CredentialSortOrder.NewestFirst;
}

/**
 * The sort order a pick of a field in the menu leads to: the other direction when the list is sorted on it already,
 * its default direction otherwise.
 * @param current - The current sort order
 * @param field - The picked field
 * @returns The new sort order
 */
export function nextSortOrder(current: CredentialSortOrder, field: ItemSortField): CredentialSortOrder {
  const parts = sortOrderParts(current);
  if (parts.field === field) {
    return toSortOrder(field, parts.direction === 'asc' ? 'desc' : 'asc');
  }
  return toSortOrder(field, ITEM_SORT_FIELDS.find(option => option.field === field)?.defaultDirection ?? 'desc');
}

/**
 * Sort entries in the given order, as a new array. Items that were never used count as the least recently used.
 * @param entries - The entries to sort
 * @param order - The sort order
 * @param getItem - Reads the item of an entry
 * @returns The sorted entries
 */
export function sortItemEntries<T>(entries: readonly T[], order: CredentialSortOrder, getItem: (entry: T) => SortableItem): T[] {
  const { field, direction } = sortOrderParts(order);
  const sign = direction === 'asc' ? 1 : -1;
  if (field === 'name') {
    return [...entries].sort((a, b) => (getItem(a).Name ?? '').localeCompare(getItem(b).Name ?? '') * sign);
  }
  const timed = entries.map(entry => ({ entry, time: fromStandardFormat(sortDate(getItem(entry), field)).getTime() }));
  return timed.sort((a, b) => (a.time - b.time) * sign).map(timedEntry => timedEntry.entry);
}

/**
 * Sort items in the given order, as a new array.
 * @param items - The items to sort
 * @param order - The sort order
 * @returns The sorted items
 */
export function sortItems<T extends SortableItem>(items: readonly T[], order: CredentialSortOrder): T[] {
  return sortItemEntries(items, order, item => item);
}

/**
 * The date group of each entry that starts one, for the headers of a list sorted on last use or last change.
 * @param entries - The entries, sorted in the given order
 * @param order - The sort order
 * @param getItem - Reads the item of an entry
 * @param reference - The moment to group against, now by default
 * @returns Per entry, the group it starts or null, or null when the order has no date groups
 */
export function recencyGroupStarts<T>(entries: readonly T[], order: CredentialSortOrder, getItem: (entry: T) => SortableItem, reference: Date = new Date()): (RecencyGroup | null)[] | null {
  const { field } = sortOrderParts(order);
  if (field !== 'lastUsed' && field !== 'lastModified') {
    return null;
  }
  let previous: RecencyGroup | null = null;
  return entries.map(entry => {
    const date = sortDate(getItem(entry), field);
    const group = date ? recencyGroup(date, reference) : 'never';
    const starts = group === previous ? null : group;
    previous = group;
    return starts;
  });
}

/**
 * The date group of a stored date-time, by local calendar days before the reference day.
 * @param value - The date-time string, in the standard format
 * @param reference - The moment to group against
 * @returns The group
 */
export function recencyGroup(value: string, reference: Date): Exclude<RecencyGroup, 'never'> {
  const date = fromStandardFormat(value);
  const days = Math.round((startOfDay(reference) - startOfDay(date)) / 86400000);
  if (days <= 0) {
    return 'today';
  }
  if (days < 7) {
    return 'last7Days';
  }
  return days < 30 ? 'last30Days' : 'older';
}

/**
 * The date an item sorts on for a date field, or an empty string for an item that was never used.
 */
function sortDate(item: SortableItem, field: Exclude<ItemSortField, 'name'>): string {
  switch (field) {
    case 'lastUsed': return item.LastUsedAt ?? '';
    case 'lastModified': return item.LastChangedAt || item.CreatedAt;
    default: return item.CreatedAt;
  }
}

/**
 * The local midnight that starts the day of a date, in milliseconds.
 */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
