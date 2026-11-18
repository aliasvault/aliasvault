import { describe, expect, it } from 'vitest';

import { CredentialSortOrder } from '../../database/repositories/SettingsRepository';
import { toStandardFormat } from '../../utilities/DateHelpers';
import { nextSortOrder, recencyGroup, recencyGroupStarts, sortItemEntries, sortItems, type SortableItem } from '../ItemSort';

/** Noon on 15 June 2026, local time. */
const REFERENCE = new Date(2026, 5, 15, 12);

/**
 * A stored date-time for a local moment a number of days and hours before the reference.
 */
function daysAgo(days: number, hours = 0): string {
  return toStandardFormat(new Date(2026, 5, 15 - days, 12 - hours));
}

/**
 * An item with a name, a creation time and optional last change and last use.
 */
function item(name: string, createdAt: string, lastChangedAt?: string, lastUsedAt?: string): SortableItem {
  return { Name: name, CreatedAt: createdAt, LastChangedAt: lastChangedAt, LastUsedAt: lastUsedAt };
}

const OLD = item('b', daysAgo(100), daysAgo(2), daysAgo(0));
const NEW = item('c', daysAgo(1), daysAgo(1), daysAgo(5));
const MIDDLE = item('a', daysAgo(50));

describe('sortItems', () => {
  it('sorts on creation', () => {
    expect(sortItems([OLD, NEW, MIDDLE], CredentialSortOrder.NewestFirst)).toEqual([NEW, MIDDLE, OLD]);
    expect(sortItems([OLD, NEW, MIDDLE], CredentialSortOrder.OldestFirst)).toEqual([OLD, MIDDLE, NEW]);
  });

  it('sorts on name', () => {
    expect(sortItems([OLD, NEW, MIDDLE], CredentialSortOrder.Alphabetical)).toEqual([MIDDLE, OLD, NEW]);
    expect(sortItems([OLD, NEW, MIDDLE], CredentialSortOrder.ReverseAlphabetical)).toEqual([NEW, OLD, MIDDLE]);
  });

  it('sorts on last use, with never used items as the least recently used', () => {
    expect(sortItems([MIDDLE, NEW, OLD], CredentialSortOrder.RecentlyUsedFirst)).toEqual([OLD, NEW, MIDDLE]);
    expect(sortItems([OLD, NEW, MIDDLE], CredentialSortOrder.RecentlyUsedLast)).toEqual([MIDDLE, NEW, OLD]);
  });

  it('sorts on last change, falling back to creation', () => {
    expect(sortItems([MIDDLE, OLD, NEW], CredentialSortOrder.RecentlyModifiedFirst)).toEqual([NEW, OLD, MIDDLE]);
    expect(sortItems([NEW, OLD, MIDDLE], CredentialSortOrder.RecentlyModifiedLast)).toEqual([MIDDLE, OLD, NEW]);
  });

  it('does not change the input', () => {
    const input = [OLD, NEW, MIDDLE];
    sortItems(input, CredentialSortOrder.NewestFirst);
    expect(input).toEqual([OLD, NEW, MIDDLE]);
  });

  it('sorts wrapped entries through the accessor', () => {
    const entries = [{ item: MIDDLE }, { item: OLD }];
    expect(sortItemEntries(entries, CredentialSortOrder.RecentlyUsedFirst, entry => entry.item).map(entry => entry.item)).toEqual([OLD, MIDDLE]);
  });
});

describe('nextSortOrder', () => {
  it('flips the direction when the field is picked again', () => {
    expect(nextSortOrder(CredentialSortOrder.NewestFirst, 'created')).toBe(CredentialSortOrder.OldestFirst);
    expect(nextSortOrder(CredentialSortOrder.OldestFirst, 'created')).toBe(CredentialSortOrder.NewestFirst);
    expect(nextSortOrder(CredentialSortOrder.Alphabetical, 'name')).toBe(CredentialSortOrder.ReverseAlphabetical);
    expect(nextSortOrder(CredentialSortOrder.RecentlyUsedFirst, 'lastUsed')).toBe(CredentialSortOrder.RecentlyUsedLast);
    expect(nextSortOrder(CredentialSortOrder.RecentlyModifiedLast, 'lastModified')).toBe(CredentialSortOrder.RecentlyModifiedFirst);
  });

  it('starts another field in its default direction', () => {
    expect(nextSortOrder(CredentialSortOrder.OldestFirst, 'lastUsed')).toBe(CredentialSortOrder.RecentlyUsedFirst);
    expect(nextSortOrder(CredentialSortOrder.RecentlyUsedLast, 'lastModified')).toBe(CredentialSortOrder.RecentlyModifiedFirst);
    expect(nextSortOrder(CredentialSortOrder.RecentlyUsedLast, 'name')).toBe(CredentialSortOrder.Alphabetical);
    expect(nextSortOrder(CredentialSortOrder.ReverseAlphabetical, 'created')).toBe(CredentialSortOrder.NewestFirst);
  });
});

describe('recencyGroup', () => {
  it('groups by local calendar days before the reference day', () => {
    expect(recencyGroup(daysAgo(0, 11), REFERENCE)).toBe('today');
    expect(recencyGroup(daysAgo(0, -1), REFERENCE)).toBe('today');
    expect(recencyGroup(daysAgo(1), REFERENCE)).toBe('last7Days');
    expect(recencyGroup(daysAgo(6), REFERENCE)).toBe('last7Days');
    expect(recencyGroup(daysAgo(7), REFERENCE)).toBe('last30Days');
    expect(recencyGroup(daysAgo(29), REFERENCE)).toBe('last30Days');
    expect(recencyGroup(daysAgo(30), REFERENCE)).toBe('older');
  });
});

describe('recencyGroupStarts', () => {
  const sorted = [daysAgo(0), daysAgo(0), daysAgo(3), daysAgo(40), daysAgo(90)].map((date, index) => item(`${index}`, daysAgo(200), date, date));

  it('marks the first entry of each group, in either direction', () => {
    expect(recencyGroupStarts(sorted, CredentialSortOrder.RecentlyModifiedFirst, entry => entry, REFERENCE)).toEqual(['today', null, 'last7Days', 'older', null]);
    expect(recencyGroupStarts([...sorted].reverse(), CredentialSortOrder.RecentlyUsedLast, entry => entry, REFERENCE)).toEqual(['older', null, 'last7Days', 'today', null]);
  });

  it('groups items without a recorded use as older when sorted on last use', () => {
    const unused = item('x', daysAgo(1), daysAgo(1));
    expect(recencyGroupStarts([sorted[0], sorted[3], unused], CredentialSortOrder.RecentlyUsedFirst, entry => entry, REFERENCE)).toEqual(['today', 'older', null]);
    expect(recencyGroupStarts([sorted[0], unused], CredentialSortOrder.RecentlyModifiedFirst, entry => entry, REFERENCE)).toEqual(['today', 'last7Days']);
  });

  it('has no groups for the other fields', () => {
    expect(recencyGroupStarts(sorted, CredentialSortOrder.NewestFirst, entry => entry, REFERENCE)).toBeNull();
    expect(recencyGroupStarts(sorted, CredentialSortOrder.Alphabetical, entry => entry, REFERENCE)).toBeNull();
  });
});
