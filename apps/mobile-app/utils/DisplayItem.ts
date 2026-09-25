import { Buffer } from 'buffer';

import type { AsyncRepository } from '@aliasvault/client/database/DbOp';
import type { ItemRef } from '@aliasvault/client/database/ItemRef';
import type { ItemWithArchivedAt, ItemWithDeletedAt } from '@aliasvault/client/database/mappers/ItemMapper';
import type { FolderRef } from '@aliasvault/client/database/repositories/FolderRepository';
import type { ItemRepository } from '@aliasvault/client/database/repositories/ItemRepository';
import type { Item } from '@aliasvault/models/vault';

/*
 * Screens keep items in React state and pass them down as props, so an item must not carry its logo as a byte array:
 * React's dev tooling walks a typed array entry by entry, and every copy of the item copies the bytes. The logo
 * travels as a data URI instead, one immutable string that an Image source takes as is. This way we avoid issue
 * with React's dev tooling causing a major slowdown (even though release builds are unaffected).
 */

/**
 * An item as the screens hold it: its logo as a data URI instead of image bytes.
 */
export type DisplayItem<T extends Item = Item> = Omit<T, 'Logo'> & {
  /** The logo as a data URI, absent when the item has no logo image. */
  LogoDataUri?: string;
};

/**
 * The item repository reads that return items.
 */
type ItemReads = 'getAll' | 'getByFolder' | 'getById' | 'getArchived' | 'getRecentlyDeleted';

/**
 * The item repository as the app uses it: every item read returns display items.
 */
export type DisplayItemRepository = Omit<AsyncRepository<ItemRepository>, ItemReads> & {
  getAll(): Promise<DisplayItem[]>;
  getByFolder(folder: FolderRef): Promise<DisplayItem[]>;
  getById(item: ItemRef): Promise<DisplayItem | null>;
  getArchived(): Promise<DisplayItem<ItemWithArchivedAt>[]>;
  getRecentlyDeleted(): Promise<DisplayItem<ItemWithDeletedAt>[]>;
};

/**
 * Wrap the item repository so that no item read hands logo bytes to a screen.
 */
export function withDisplayItems(repository: AsyncRepository<ItemRepository>): DisplayItemRepository {
  const reads: Pick<DisplayItemRepository, ItemReads> = {
    getAll: async () => toDisplayItems(await repository.getAll()),
    getByFolder: async (folder) => toDisplayItems(await repository.getByFolder(folder)),
    getById: async (ref) => {
      const item = await repository.getById(ref);
      return item ? toDisplayItems([item])[0] : null;
    },
    getArchived: async () => toDisplayItems(await repository.getArchived()),
    getRecentlyDeleted: async () => toDisplayItems(await repository.getRecentlyDeleted()),
  };

  return new Proxy(repository, {
    /**
     * Resolve a member, substituting the item reads.
     */
    get: (target, property): unknown => Object.prototype.hasOwnProperty.call(reads, property) ? reads[property as ItemReads] : Reflect.get(target, property),
  }) as unknown as DisplayItemRepository;
}

/**
 * Replace each item's logo bytes with a data URI.
 */
export function toDisplayItems<T extends Item>(items: T[]): DisplayItem<T>[] {
  // Keyed by logo row, so items that share a logo share one string.
  const dataUris = new Map<string, string | undefined>();

  /**
   * The data URI of an item's logo, encoded once per logo row.
   */
  const dataUriOf = (item: T): string | undefined => {
    if (!item.Logo || item.Logo.length === 0) {
      return undefined;
    }
    if (!item.LogoInfo) {
      return logoToDataUri(item.Logo);
    }
    const key = `${item.ManifestId}/${item.LogoInfo.Id}`;
    if (!dataUris.has(key)) {
      dataUris.set(key, logoToDataUri(item.Logo));
    }
    return dataUris.get(key);
  };

  return items.map((item) => {
    const { Logo: _logo, ...rest } = item;
    const logoDataUri = dataUriOf(item);
    return logoDataUri ? { ...rest, LogoDataUri: logoDataUri } : rest;
  });
}

/**
 * Encode logo bytes as a data URI, or undefined when they cannot be encoded.
 */
export function logoToDataUri(logo: Uint8Array | number[]): string | undefined {
  try {
    const bytes = logo instanceof Uint8Array ? logo : Uint8Array.from(logo);
    return `data:${detectMimeType(bytes)};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch (error) {
    // A broken logo shows the placeholder; it must not fail the whole item read.
    console.error('Error converting logo:', error);
    return undefined;
  }
}

/**
 * Detect an image's MIME type from its file signature, defaulting to an icon.
 */
function detectMimeType(bytes: Uint8Array): string {
  const header = String.fromCharCode(...bytes.subarray(0, 5)).toLowerCase();
  if (header.includes('<?xml') || header.includes('<svg')) {
    return 'image/svg+xml';
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return 'image/png';
  }
  return 'image/x-icon';
}
