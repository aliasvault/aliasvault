import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { mergeItems, planMerge, suggestTarget, type MergeChoices, type MergeSide } from '../ItemMerge';

import { customField, section, systemField as field } from './testFields';

import type { ItemField, ItemType } from '@aliasvault/models/vault';

const PERSONAL = '11111111-1111-4111-8111-111111111111';
const SHARED = '22222222-2222-4222-8222-222222222222';

type SideOptions = { name?: string | null; type?: ItemType; manifestId?: string; createdAt?: string } & Partial<Omit<MergeSide, 'item'>>;

/**
 * One side of a merge.
 * @param id - The item id, also its name unless given
 * @param fields - The item's fields
 * @param options - Overrides of the item and its child rows
 * @returns The side
 */
function side(id: string, fields: ItemField[] = [], options: SideOptions = {}): MergeSide {
  return {
    item: { Id: id, ManifestId: options.manifestId ?? PERSONAL, Name: options.name === undefined ? id : options.name, ItemType: options.type ?? ItemTypes.Login, Fields: fields, CreatedAt: options.createdAt ?? '2026-01-01 00:00:00.000', UpdatedAt: '' },
    passkeys: options.passkeys ?? [],
    totpCodes: options.totpCodes ?? [],
    attachments: options.attachments ?? [],
    lastChangedAt: options.lastChangedAt ?? '2026-01-01 00:00:00.000',
    lastUsedAt: options.lastUsedAt ?? null,
  };
}

/**
 * Merge with new custom field ids numbered new-1, new-2, ...
 * @param target - The item that is kept
 * @param source - The item that is folded into it
 * @param choices - The user's choice per conflict
 * @returns The merge result
 */
function merge(target: MergeSide, source: MergeSide, choices: MergeChoices = {}): ReturnType<typeof mergeItems> {
  let next = 0;
  return mergeItems(target, source, choices, () => `new-${++next}`);
}

/**
 * A passkey for example.com.
 * @param id - The passkey id
 * @returns The passkey
 */
function passkey(id: string): MergeSide['passkeys'][number] {
  return { Id: id, RpId: 'example.com', DisplayName: 'bob' };
}

describe('planMerge', () => {
  it('only asks about single values both items fill differently', () => {
    const target = side('a', [field('login.username', 'bob'), field('login.email', 'Bob@Example.com'), field('login.password', 'one', { IsHidden: true }), field('login.url', 'https://a.example'), field('notes.content', 'A')], { name: 'GitHub' });
    const source = side('b', [field('login.username', 'bob'), field('login.email', 'bob@example.com'), field('login.password', 'two', { IsHidden: true }), field('login.url', 'https://b.example'), field('notes.content', 'B'), field('alias.first_name', 'Bob')], { name: 'github.com' });

    expect(planMerge(target, source)).toEqual({
      blocker: null,
      conflicts: [
        { key: 'name', target: 'GitHub', source: 'github.com', isHidden: false },
        { key: 'login.password', target: 'one', source: 'two', isHidden: true },
      ],
    });
  });

  it('does not ask about names that differ only in case, or a name only one item has', () => {
    expect(planMerge(side('a', [], { name: 'GitHub' }), side('b', [], { name: 'github' })).conflicts).toEqual([]);
    expect(planMerge(side('a', [], { name: 'GitHub' }), side('b', [], { name: ' ' })).conflicts).toEqual([]);
  });

  it('asks about passkeys only when both items hold one', () => {
    expect(planMerge(side('a', [], { name: 'Example', passkeys: [passkey('p1')] }), side('b', [], { name: 'Example' })).conflicts).toEqual([]);
    expect(planMerge(side('a', [], { name: 'Example', passkeys: [passkey('p1')] }), side('b', [], { name: 'Example', passkeys: [passkey('p2')] })).conflicts).toEqual([
      { key: 'passkeys', target: 'example.com (bob)', source: 'example.com (bob)', isHidden: false },
    ]);
  });

  it.each([
    ['a Login and a Note', side('a'), side('b', [], { type: ItemTypes.Note }), null],
    ['a Login and an Alias', side('a'), side('b', [], { type: ItemTypes.Alias }), null],
    ['manifest ids that differ only in case', side('a'), side('b', [], { manifestId: PERSONAL.toUpperCase() }), null],
    ['items in different manifests', side('a'), side('b', [], { manifestId: SHARED }), 'manifest'],
    ['a Login and a credit card', side('a'), side('b', [], { type: ItemTypes.CreditCard }), 'type'],
    ['a type mismatch across manifests', side('a'), side('b', [], { type: ItemTypes.CreditCard, manifestId: SHARED }), 'type'],
    ['the same item twice', side('a'), side('a'), 'same-item'],
  ])('blocker for %s', (_, target, source, blocker) => {
    expect(planMerge(target, source).blocker).toBe(blocker);
  });
});

describe('mergeItems', () => {
  describe('name and conflicting values', () => {
    const target = side('a', [field('login.password', 'old', { EnableHistory: true }), field('login.username', 'alice', { EnableHistory: true }), field('login.email', 'a@example.com')], { name: 'Target' });
    const source = side('b', [field('login.password', 'new', { EnableHistory: true }), field('login.username', 'bob', { EnableHistory: true }), field('login.email', 'b@example.com')], { name: 'Source' });

    it('keeps the target\'s values when nothing is chosen', () => {
      const merged = merge(target, source);
      expect(merged.name).toBe('Target');
      expect(merged.fields.map(f => f.Value)).toEqual(['old', 'alice', 'a@example.com']);
    });

    it('keeps the chosen values and reports the replaced one of every field that keeps history', () => {
      const merged = merge(target, source, { name: 'source', 'login.password': 'source', 'login.email': 'source' });
      expect(merged.name).toBe('Source');
      expect(merged.fields.map(f => f.Value)).toEqual(['new', 'alice', 'b@example.com']);
      expect(merged.replacedValues).toEqual([{ fieldKey: 'login.password', value: 'old' }, { fieldKey: 'login.username', value: 'bob' }]);
    });

    it('takes the source\'s name when the target has none', () => {
      expect(merge(side('a', [], { name: null }), side('b', [], { name: 'Source' })).name).toBe('Source');
    });
  });

  it('joins URLs and notes and fills what the target lacks', () => {
    const target = side('a', [field('login.url', ['https://a.example/', 'https://b.example']), field('notes.content', 'Target notes')]);
    const source = side('b', [field('login.url', ['https://A.example', 'https://c.example']), field('notes.content', 'Source notes'), field('login.username', 'bob')]);

    const merged = merge(target, source);

    expect(merged.fields).toEqual([
      field('login.url', ['https://a.example/', 'https://b.example', 'https://c.example']),
      field('notes.content', 'Target notes\n\nSource notes'),
      field('login.username', 'bob'),
    ]);
    expect(merged.replacedValues).toEqual([]);
  });

  it.each([
    ['notes the target already holds', 'Line one\n\nLine two', 'Line two', 'Line one\n\nLine two'],
    ['notes only the source has', '', 'Source notes', 'Source notes'],
    ['notes only the target has', 'Target notes', '', 'Target notes'],
  ])('keeps %s once', (_, targetNotes, sourceNotes, expected) => {
    expect(merge(side('a', [field('notes.content', targetNotes)]), side('b', [field('notes.content', sourceNotes)])).fields).toEqual([field('notes.content', expected)]);
  });

  it('adds custom fields under a new definition id, keeps every field in its section and skips identical ones', () => {
    const target = side('a', [customField('t1', 'PIN', '1234', 1), section('ts', 'Server', 2), customField('t2', 'Host', 'a.example', 3)]);
    const source = side('b', [customField('s1', 'PIN', '1234', 1), customField('s2', 'Recovery', 'abc', 2), section('ss', 'API', 3), customField('s3', 'Key', 'xyz', 4), section('se', 'Empty', 5)]);

    expect(merge(target, source).fields.map(f => [f.FieldKey, f.Label, f.DisplayOrder])).toEqual([
      // Fields above every section: the target's, then the source's.
      ['t1', 'PIN', 1],
      ['new-1', 'Recovery', 2],
      // The target's sections, then the source's; the source's empty section is dropped.
      ['ts', 'Server', 3],
      ['t2', 'Host', 4],
      ['new-2', 'API', 5],
      ['new-3', 'Key', 6],
    ]);
  });

  it.each([
    ['a Login that takes over identity fields becomes an Alias', side('a'), side('b', [field('alias.first_name', 'Bob')], { type: ItemTypes.Alias }), ItemTypes.Alias],
    ['a Login that takes over no identity fields stays a Login', side('a'), side('b', [field('login.email', 'x@example.com')], { type: ItemTypes.Alias }), ItemTypes.Login],
    ['an Alias stays an Alias', side('a', [], { type: ItemTypes.Alias }), side('b'), ItemTypes.Alias],
    ['a Note takes the source\'s type', side('a', [], { type: ItemTypes.Note }), side('b'), ItemTypes.Login],
  ])('%s', (_, target, source, itemType) => {
    expect(merge(target, source).itemType).toBe(itemType);
  });

  it('copies 2FA codes the target does not hold yet, comparing secrets without spaces, padding or case', () => {
    const target = side('a', [], { totpCodes: [{ Id: 'ta', SecretKey: 'JBSW Y3DP' }] });
    const source = side('b', [], { totpCodes: [{ Id: 'sa', SecretKey: 'jbswy3dp==' }, { Id: 'sb', SecretKey: 'OTHER' }, { Id: 'sc', SecretKey: 'other' }] });

    expect(merge(target, source).totpCodesToCopy).toEqual(['sb']);
  });

  it('copies attachments the target does not hold yet, comparing name and hash, or size without a hash', () => {
    const target = side('a', [], { attachments: [{ Id: 'ta', Filename: 'scan.pdf', BlobHash: 'h1', Size: 10 }, { Id: 'tb', Filename: 'local.txt', BlobHash: null, Size: 5 }] });
    const source = side('b', [], {
      attachments: [
        { Id: 'same-hash', Filename: 'scan.pdf', BlobHash: 'h1', Size: 10 },
        { Id: 'other-hash', Filename: 'scan.pdf', BlobHash: 'h2', Size: 10 },
        { Id: 'same-size', Filename: 'local.txt', BlobHash: null, Size: 5 },
        { Id: 'other-size', Filename: 'local.txt', BlobHash: null, Size: 6 },
        { Id: 'other-name', Filename: 'copy.pdf', BlobHash: 'h1', Size: 10 },
      ],
    });

    expect(merge(target, source).attachmentsToCopy).toEqual(['other-hash', 'other-size', 'other-name']);
  });

  it.each([
    ['both hold one: the target\'s by default', [passkey('pa')], [passkey('pb')], {}, [], []],
    ['both hold one: the target\'s when picked', [passkey('pa')], [passkey('pb')], { passkeys: 'target' }, [], []],
    ['both hold one: the source\'s when picked, the target\'s moves to the trashed source', [passkey('pa')], [passkey('pb')], { passkeys: 'source' }, ['pb'], ['pa']],
    ['only the source holds one: it moves to the target', [], [passkey('pb')], {}, ['pb'], []],
    ['only the target holds one: nothing moves, whatever is picked', [passkey('pa')], [], { passkeys: 'source' }, [], []],
  ] as const)('keeps one passkey when %s', (_, targetPasskeys, sourcePasskeys, choices, passkeysToTarget, passkeysToSource) => {
    const merged = merge(side('a', [], { passkeys: [...targetPasskeys] }), side('b', [], { passkeys: [...sourcePasskeys] }), choices);
    expect(merged).toMatchObject({ passkeysToTarget, passkeysToSource });
  });
});

describe('suggestTarget', () => {
  it('suggests the item that holds more, counting fields and child rows', () => {
    const login = side('login', [field('login.username', 'bob'), field('login.password', 'pw'), field('login.url', 'https://example.com')], { createdAt: '2026-05-01 00:00:00.000' });
    const imported = side('imported', [field('login.username', 'bob')], { createdAt: '2026-01-01 00:00:00.000', totpCodes: [{ Id: 't', SecretKey: 'S' }] });

    expect(suggestTarget(imported, login)).toBe(login);
    expect(suggestTarget(login, imported)).toBe(login);
  });

  it('suggests the older item when both hold as much', () => {
    const newer = side('new', [], { createdAt: '2026-02-01 00:00:00.000' });
    const older = side('old', [], { createdAt: '2026-01-01 00:00:00.000' });

    expect(suggestTarget(newer, older)).toBe(older);
    expect(suggestTarget(older, newer)).toBe(older);
  });
});
