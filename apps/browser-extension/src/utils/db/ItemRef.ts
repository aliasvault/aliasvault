import type { Item } from '@/utils/dist/core/models/vault';

/**
 * A manifest-qualified reference to an item: the only thing that names one item in the vault.
 *
 * Items are keyed by `(ManifestId, Id)`, so an Id on its own is not an identity — a shared manifest
 * may hold an item whose Id matches one of the user's own. Anything that reads an item's child rows
 * or writes to them takes one of these, and an `Item` is structurally assignable to it.
 */
export type ItemRef = {
  Id: string;
  ManifestId: string;
};

/**
 * The grouping key for a manifest-scoped row: its manifest and its id, in that order.
 *
 * Used wherever rows fetched by one query are joined to rows fetched by another (items to their
 * fields, items to their tags, items to their folder paths). Keying those maps by id alone would let
 * one manifest's rows land on another manifest's item.
 * @param manifestId - The owning manifest's id
 * @param id - The row's id within that manifest
 * @returns A key unique across manifests
 */
export function scopedKey(manifestId: string, id: string): string {
  return `${manifestId}${id}`;
}

/**
 * The grouping key of an item reference. Shorthand for {@link scopedKey}.
 * @param ref - The item reference
 * @returns A key unique across manifests
 */
export function itemKey(ref: ItemRef): string {
  return scopedKey(ref.ManifestId, ref.Id);
}

/**
 * Flatten item references into the bind list a row-value `IN (VALUES (?, ?), …)` match expects:
 * manifest first, then id, for each item in order.
 * @param refs - The item references to bind
 * @returns The bind parameters, in placeholder order
 */
export function itemKeyBindings(refs: ItemRef[]): string[] {
  return refs.flatMap(ref => [ref.ManifestId, ref.Id]);
}

/**
 * An item as the UI holds it, whose manifest may not be decided yet.
 *
 * A new item has no manifest until the vault writes it: which manifest it lands in follows from the
 * folder it is created in. Everything read back out of the vault is a full {@link Item} and carries
 * one, so this is only ever wider than an Item, never narrower.
 */
export type DraftItem = Omit<Item, 'ManifestId'> & { ManifestId?: string };
