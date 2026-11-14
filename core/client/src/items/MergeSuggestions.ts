import { FieldKey } from '@aliasvault/models/vault';

import type { Item } from '@aliasvault/models/vault';

/**
 * The first non-empty value of a field.
 * @param item - The item
 * @param fieldKey - The system field key
 * @returns The value, or an empty string
 */
function firstValue(item: Item, fieldKey: string): string {
  const value = item.Fields.find(field => field.FieldKey === fieldKey)?.Value;
  const values = Array.isArray(value) ? value : [value];
  return values.find(entry => typeof entry === 'string' && entry.trim() !== '')?.trim() ?? '';
}

/**
 * The URLs of an item.
 * @param item - The item
 * @returns The non-empty URLs
 */
export function urlsOf(item: Item): string[] {
  const value = item.Fields.find(field => field.FieldKey === FieldKey.LoginUrl)?.Value;
  return (Array.isArray(value) ? value : [value]).filter((url): url is string => typeof url === 'string' && url.trim() !== '');
}

/**
 * The identities an item signs in with: its username and email address.
 * @param item - The item
 * @returns The normalized identities
 */
function identitiesOf(item: Item): string[] {
  return [firstValue(item, FieldKey.LoginUsername), firstValue(item, FieldKey.LoginEmail)].filter(Boolean).map(value => value.toLowerCase());
}

/**
 * What the merge suggestions compare of an item.
 */
type MergeProfile = {
  domains: Set<string>;
  siteLabels: Set<string>;
  name: string;
  nameWords: Set<string>;
  identities: string[];
  password: string;
};

/**
 * The merge profile of an item.
 * @param item - The item
 * @param rootDomainOf - The registrable domain of a URL, or null when it has none
 * @returns The profile
 */
function mergeProfileOf(item: Item, rootDomainOf: (url: string) => string | null): MergeProfile {
  const domains = new Set(urlsOf(item).map(url => rootDomainOf(url)?.toLowerCase()).filter((domain): domain is string => !!domain));
  const name = (item.Name ?? '').toLowerCase();
  return {
    domains,
    siteLabels: new Set([...domains].map(domain => domain.split('.')[0])),
    name: name.replace(/[^\p{L}\p{N}]/gu, ''),
    nameWords: new Set(name.split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3)),
    identities: identitiesOf(item),
    password: firstValue(item, FieldKey.LoginPassword),
  };
}

/**
 * How strongly two items point at the same site: 3 for a shared registrable domain, 2 for the same site name in a URL
 * or item name ("amazon.de" and "amazon.com", or "GitHub" and https://github.com), 0 otherwise.
 * @param a - One profile
 * @param b - The other profile
 * @returns The site score
 */
function siteScore(a: MergeProfile, b: MergeProfile): number {
  if ([...a.domains].some(domain => b.domains.has(domain))) {
    return 3;
  }
  const aNames = new Set([...a.siteLabels, ...a.nameWords, a.name].filter(Boolean));
  const bNames = new Set([...b.siteLabels, ...b.nameWords, b.name].filter(Boolean));
  const sameSiteName = [...a.siteLabels, a.name].some(key => key && bNames.has(key)) || [...b.siteLabels, b.name].some(key => key && aNames.has(key));
  return sameSiteName ? 2 : 0;
}

/**
 * Whether two identities are the same account: equal, or an email address and a username equal to its local part.
 * @param a - One identity
 * @param b - The other identity
 * @returns Whether they match
 */
function sameIdentity(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const [email, other] = a.includes('@') ? [a, b] : [b, a];
  return email.includes('@') && !other.includes('@') && email.split('@')[0] === other;
}

/**
 * How strongly two items point at the same account: 3 for a shared username or email address, 1 when either has
 * none (a 2FA code or passkey on its own), 0 when both have one and they differ.
 * @param a - One profile
 * @param b - The other profile
 * @returns The identity score
 */
function identityScore(a: MergeProfile, b: MergeProfile): number {
  if (a.identities.length === 0 || b.identities.length === 0) {
    return 1;
  }
  return a.identities.some(x => b.identities.some(y => sameIdentity(x, y))) ? 3 : 0;
}

/**
 * The items `item` is most likely to be merged with, best match first. A candidate needs the same site (by domain or
 * by name); a shared username, email address or password ranks it higher, and so does one side lacking the password
 * the other has (an imported 2FA code or passkey next to the login).
 * @param item - The item to merge
 * @param candidates - The items it can be merged with
 * @param rootDomainOf - The registrable domain of a URL, or null when it has none
 * @param limit - The most suggestions to return
 * @returns The suggestions, without the item itself
 */
export function suggestMergeCandidates(item: Item, candidates: Item[], rootDomainOf: (url: string) => string | null, limit = 5): Item[] {
  const profile = mergeProfileOf(item, rootDomainOf);
  return candidates
    .filter(candidate => candidate !== item)
    .map(candidate => {
      const other = mergeProfileOf(candidate, rootDomainOf);
      const site = siteScore(profile, other);
      const samePassword = profile.password !== '' && other.password === profile.password;
      const complements = (profile.password === '') !== (other.password === '') ? 1 : 0;
      return { candidate, score: site > 0 ? site + identityScore(profile, other) + (samePassword ? 3 : 0) + complements : 0 };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.candidate.Name ?? '').localeCompare(b.candidate.Name ?? ''))
    .slice(0, limit)
    .map(entry => entry.candidate);
}
