import { ItemTypes } from '@aliasvault/models/vault';
import { describe, expect, it } from 'vitest';

import { suggestMergeCandidates, type UrlDomain } from '../MergeSuggestions';

import { systemField } from './testFields';

import type { Item } from '@aliasvault/models/vault';

/**
 * A live item with the given system field values.
 * @param id - The item id, also its name unless given
 * @param values - System field values by key
 * @param name - The item name
 * @returns The item
 */
function item(id: string, values: Record<string, string | string[]>, name: string = id): Item {
  return {
    Id: id,
    ManifestId: '11111111-1111-4111-8111-111111111111',
    Name: name,
    ItemType: ItemTypes.Login,
    Fields: Object.entries(values).map(([fieldKey, value]) => systemField(fieldKey, value)),
    CreatedAt: '2025-01-01 00:00:00.000',
    UpdatedAt: '2025-01-01 00:00:00.000',
  };
}

/**
 * The host of a test URL without `www.`, and its last two labels as the registrable domain.
 * @param url - The URL
 * @returns The domains
 */
function domainOf(url: string): UrlDomain | null {
  const host = url.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  return host ? { host, root: host.split('.').slice(-2).join('.') } : null;
}

/**
 * The ids of the suggested candidates, best match first.
 * @param base - The item to merge
 * @param candidates - The items it can be merged with
 * @param limit - The most suggestions to return
 * @returns The ids
 */
function suggest(base: Item, candidates: Item[], limit?: number): string[] {
  return suggestMergeCandidates(base, candidates, domainOf, limit).map(entry => entry.Id);
}

describe('suggestMergeCandidates', () => {
  describe('account', () => {
    it('suggests the same account and an item without one, never another account', () => {
      const totp = item('totp', { 'login.username': 'bob@example.com' }, 'GitHub');
      const candidates = [
        item('alice', { 'login.url': 'https://github.com', 'login.username': 'alice', 'login.password': 'secret' }),
        // A username equal to the email address's local part is the same account.
        item('bob', { 'login.url': 'https://github.com', 'login.username': 'bob', 'login.password': 'secret' }),
        item('gist', { 'login.url': 'https://gist.github.com', 'login.password': 'secret' }),
        item('github-work', {}, 'GitHub (work)'),
      ];

      expect(suggest(totp, [totp, ...candidates])).toEqual(['bob', 'gist', 'github-work']);
      expect(suggest(totp, candidates, 2)).toEqual(['bob', 'gist']);
    });

    it('matches an email address in either the username or the email field', () => {
      const login = item('login', { 'login.url': 'https://github.com', 'login.email': 'Bob@Example.com' });

      expect(suggest(login, [item('other', { 'login.url': 'https://github.com', 'login.username': 'bob@example.com' })])).toEqual(['other']);
    });
  });

  describe('site', () => {
    it('never suggests another site for the same account', () => {
      const login = item('login', { 'login.url': 'https://github.com', 'login.username': 'bob' });

      expect(suggest(login, [item('gitlab', { 'login.url': 'https://gitlab.com', 'login.username': 'bob' })])).toEqual([]);
    });

    it('matches a subdomain with its parent domain, not with another subdomain of it', () => {
      const instance = item('x', { 'login.url': 'https://x.aliasvault.com' }, 'AliasVault');
      const candidates = [
        item('other-instance', { 'login.url': 'https://y.aliasvault.com' }, 'AliasVault'),
        item('parent', { 'login.url': 'https://aliasvault.com' }),
        item('same-host', { 'login.url': 'https://www.x.aliasvault.com/login' }),
      ];

      expect(suggest(instance, candidates)).toEqual(['parent', 'same-host']);
    });

    it('ranks the same domain above the same site name and ignores shared generic words', () => {
      const login = item('login', { 'login.url': 'https://amazon.com', 'login.email': 'bob@example.com' }, 'Amazon account');
      const candidates = [
        item('amazon-de', { 'login.url': 'https://amazon.de', 'login.email': 'bob@example.com' }),
        item('amazon-com', { 'login.url': 'https://www.amazon.com', 'login.email': 'bob@example.com' }),
        item('microsoft', { 'login.url': 'https://microsoft.com', 'login.email': 'bob@example.com' }, 'Microsoft account'),
      ];

      expect(suggest(login, candidates)).toEqual(['amazon-com', 'amazon-de']);
    });

    it('orders equal matches by name', () => {
      const login = item('login', { 'login.url': 'https://github.com' });

      expect(suggest(login, [item('b', { 'login.url': 'https://github.com' }, 'Zed'), item('a', { 'login.url': 'https://github.com' }, 'Abe')])).toEqual(['a', 'b']);
    });
  });

  describe('password', () => {
    it('ranks a shared password up on the same site', () => {
      const passkey = item('passkey', { 'login.url': 'https://github.com', 'login.password': 'one-of-a-kind' });
      const candidates = [item('other', { 'login.url': 'https://github.com', 'login.password': 'different' }), item('same', { 'login.url': 'https://github.com', 'login.password': 'one-of-a-kind' })];

      expect(suggest(passkey, candidates)).toEqual(['same', 'other']);
    });

    it('ranks an item up that fills the missing password', () => {
      const totp = item('totp', { 'login.url': 'https://github.com' });
      const candidates = [item('no-password', { 'login.url': 'https://github.com' }, 'A'), item('password', { 'login.url': 'https://github.com', 'login.password': 'pw' }, 'B')];

      expect(suggest(totp, candidates)).toEqual(['password', 'no-password']);
    });

    it('does not suggest another site for a shared password', () => {
      const reused = ['a', 'b', 'c'].map(id => item(id, { 'login.url': `https://${id}.com`, 'login.email': 'bob@example.com', 'login.password': 'hunter2' }));

      expect(suggest(reused[0], reused)).toEqual([]);
    });
  });
});
