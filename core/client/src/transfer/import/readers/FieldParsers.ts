import { ItemTypes, type ItemType } from '@aliasvault/models/vault';

import { isBlank } from '../../shared/StringUtils';

/**
 * Split a URL column that may hold several comma separated URLs.
 * @param url - The URL text
 * @returns The URLs, or null when there are none
 */
export function parseUrls(url: string | null | undefined): string[] | null {
  const urls = (url ?? '').split(',').map(u => u.trim()).filter(u => u.length > 0);
  return urls.length > 0 ? urls : null;
}

/**
 * Map a source's item type name to an item type.
 * @param value - The source's type name
 * @param types - Lower case type names to item types
 * @returns The item type, Login for unknown names, or null when the name is empty
 */
export function mapItemType(value: string | null | undefined, types: Readonly<Record<string, ItemType>>): ItemType | null {
  if (isBlank(value)) {
    return null;
  }
  const key = value.toLowerCase();
  return Object.hasOwn(types, key) ? types[key] : ItemTypes.Login;
}
