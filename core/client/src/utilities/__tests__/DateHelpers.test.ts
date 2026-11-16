import en from '@aliasvault/i18n/locales/en.json';
import { describe, expect, it } from 'vitest';

import { toRecentDisplayFormat, toRelativeDisplayFormat } from '../DateHelpers';

const reference = new Date('2026-11-16T12:00:00Z');

/**
 * Looks a key up in the English translations, picking the English plural form and filling in the count.
 * @param key - The translation key
 * @param options - The count for a plural key
 * @returns The English text
 */
function t(key: string, options?: { count: number }): string {
  const path = options ? `${key}_${options.count === 1 ? 'one' : 'other'}` : key;
  const text = path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en);
  if (typeof text !== 'string') {
    throw new Error(`Missing translation ${path}`);
  }
  return text.replace('{{count}}', String(options?.count));
}

describe('toRelativeDisplayFormat', () => {
  it('reads under a minute and a future moment as just now', () => {
    expect(toRelativeDisplayFormat('2026-11-16 11:59:30.000', t, reference)).toBe('just now');
    expect(toRelativeDisplayFormat('2026-11-16 12:05:00.000', t, reference)).toBe('just now');
  });

  it('uses the largest whole unit', () => {
    expect(toRelativeDisplayFormat('2026-11-16 11:59:00.000', t, reference)).toBe('1 min ago');
    expect(toRelativeDisplayFormat('2026-11-16 09:00:00.000', t, reference)).toBe('3 hrs ago');
    expect(toRelativeDisplayFormat('2026-11-15 06:00:00.000', t, reference)).toBe('yesterday');
    expect(toRelativeDisplayFormat('2026-11-13 12:00:00.000', t, reference)).toBe('3 days ago');
    expect(toRelativeDisplayFormat('2026-09-01 12:00:00.000', t, reference)).toBe('2 months ago');
    expect(toRelativeDisplayFormat('2023-11-01 12:00:00.000', t, reference)).toBe('3 years ago');
  });

  it('returns a value it cannot parse as-is', () => {
    expect(toRelativeDisplayFormat('not a date', t, reference)).toBe('not a date');
  });
});

describe('toRecentDisplayFormat', () => {
  it('stays relative under two days', () => {
    expect(toRecentDisplayFormat('2026-11-16T11:15:00Z', t, reference)).toBe('45 mins ago');
    expect(toRecentDisplayFormat('2026-11-14T12:00:01Z', t, reference)).toBe('yesterday');
  });

  it('shows the day and month from two days on', () => {
    const value = '2026-11-14T12:00:00Z';
    expect(toRecentDisplayFormat(value, t, reference)).toBe(new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }));
  });
});
