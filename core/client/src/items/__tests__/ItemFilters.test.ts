import { FieldTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { applySearchFilter, matchesSearchWord } from '../ItemFilters';

import type { Item, ItemField } from '@aliasvault/models/vault';

type SearchItem = Pick<Item, 'Name' | 'Fields'>;

/**
 * Build a test field.
 */
const field = (Value: string, FieldType: string = FieldTypes.Text): ItemField => ({ Value, FieldType, IsHidden: false, Label: '' } as ItemField);

/**
 * Build a test item.
 */
const item = (Name: string, ...Fields: ItemField[]): SearchItem => ({ Name, Fields });

describe('matchesSearchWord', () => {
  it('matches at the start of a word', () => {
    expect(matchesSearchWord('my bank', 'bank')).toBe(true);
    expect(matchesSearchWord('bank account', 'bank')).toBe(true);
    expect(matchesSearchWord('databank', 'bank')).toBe(false);
  });

  it('treats any non-letter, non-digit character as a word boundary', () => {
    expect(matchesSearchWord('https://github.com/login', 'github.com')).toBe(true);
    expect(matchesSearchWord('https://mysubdomain.example.com', 'mysubdomain.ex')).toBe(true);
    expect(matchesSearchWord('john@gmail.com', 'gmail')).toBe(true);
    expect(matchesSearchWord('my-bank', 'bank')).toBe(true);
    expect(matchesSearchWord('foo/bank', 'bank')).toBe(true);
    expect(matchesSearchWord('first_last', 'last')).toBe(true);
  });

  it('does not match inside a word', () => {
    expect(matchesSearchWord('https://notexample.com', 'example.com')).toBe(false);
    expect(matchesSearchWord('john@gmail.com', 'mail')).toBe(false);
    expect(matchesSearchWord('paypal', 'pal')).toBe(false);
    expect(matchesSearchWord('café', 'fé')).toBe(false);
  });

  it('checks every occurrence, not only the first', () => {
    expect(matchesSearchWord('databank bank', 'bank')).toBe(true);
  });

  it('matches anywhere when the word starts with punctuation', () => {
    expect(matchesSearchWord('https://example.com', '.com')).toBe(true);
    expect(matchesSearchWord('john@gmail.com', '@gmail')).toBe(true);
  });

  it('matches anywhere in scripts written without spaces', () => {
    expect(matchesSearchWord('中国银行', '银行')).toBe(true);
    expect(matchesSearchWord('アマゾンジャパン', 'ジャパン')).toBe(true);
  });

  it('treats an astral letter before the match as part of the word', () => {
    expect(matchesSearchWord('𝒜bank', 'bank')).toBe(false);
    expect(matchesSearchWord('😀bank', 'bank')).toBe(true);
  });

  it('treats * as any characters', () => {
    expect(matchesSearchWord('databank', '*bank')).toBe(true);
    expect(matchesSearchWord('databank', '*ban*')).toBe(true);
    expect(matchesSearchWord('my bank', 'b*k')).toBe(true);
    expect(matchesSearchWord('databank', 'b*k')).toBe(false);
    expect(matchesSearchWord('bank account', 'bank*count')).toBe(true);
    expect(matchesSearchWord('bank account', 'count*bank')).toBe(false);
    expect(matchesSearchWord('bank', 'bank*')).toBe(true);
    expect(matchesSearchWord('anything', '*')).toBe(true);
  });
});

describe('applySearchFilter', () => {
  const items = [
    item('Databank', field('player@databank.net')),
    item('My Bank', field('https://www.mybank.com'), field('bank-user')),
    item('Shop', field('bank', FieldTypes.Password)),
  ];

  it('returns all items for an empty term', () => {
    expect(applySearchFilter(items, '   ')).toHaveLength(3);
  });

  it('keeps only word-start matches and skips secret values', () => {
    expect(applySearchFilter(items, 'bank').map(i => i.Name)).toEqual(['My Bank']);
  });

  it('requires every query word to match', () => {
    expect(applySearchFilter(items, 'my bank').map(i => i.Name)).toEqual(['My Bank']);
    expect(applySearchFilter(items, 'my databank')).toHaveLength(0);
  });

  it('lifts the word-start rule with a leading *', () => {
    expect(applySearchFilter(items, '*bank').map(i => i.Name)).toEqual(['Databank', 'My Bank']);
  });

  it('is case-insensitive', () => {
    expect(applySearchFilter(items, 'DATA').map(i => i.Name)).toEqual(['Databank']);
  });
});
