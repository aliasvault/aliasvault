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
 * The grouping key for a manifest-scoped row: its manifest and its id, separated by a pipe symbol.
 * @param manifestId - The owning manifest's id
 * @param id - The row's id within that manifest
 * @returns A key unique across manifests
 */
export function scopedKey(manifestId: string, id: string): string {
  return `${manifestId}|${id}`;
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
 * The manifest a new item belongs in: the one its folder is in, or the personal manifest outside any folder.
 * @param folder - The folder the item is created in, or null for none
 * @param personalManifestId - The user's personal manifest id
 * @returns The manifest id to set on the item
 */
export function manifestForItemIn(folder: { ManifestId: string } | null | undefined, personalManifestId: string | null | undefined): string {
  const manifestId = folder?.ManifestId ?? personalManifestId;
  if (!manifestId) {
    throw new Error('This client has no personal manifest recorded yet; sync once before writing.');
  }
  return manifestId;
}
