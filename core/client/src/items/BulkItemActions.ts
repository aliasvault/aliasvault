import { type ItemRef, scopedKey } from '../database/ItemRef';

import type { FolderRef } from '../database/repositories/FolderRepository';

/**
 * A selected item as the bulk actions need it: its key and the folder it is presented in.
 */
export type SelectedItem = ItemRef & { FolderId?: string | null };

/**
 * Keep only the fields a selection needs, so a selection never holds whole items.
 * @param item - The item to select
 * @returns The selected item
 */
export function toSelectedItem(item: SelectedItem): SelectedItem {
  return { Id: item.Id, ManifestId: item.ManifestId, FolderId: item.FolderId ?? null };
}

/**
 * The key of a selected item, unique across manifests.
 * @param item - The selected item
 * @returns The item's manifest-scoped key
 */
export function selectedItemKey(item: SelectedItem): string {
  return scopedKey(item.ManifestId, item.Id);
}

/**
 * What a bulk move changes, so a client can decide whether to confirm it.
 */
export type BulkMoveSummary = {
  toMove: ItemRef[];
  /** Whether any item moves into a shared folder. */
  toShared: boolean;
  /** Whether any item moves out of a shared folder. */
  fromShared: boolean;
};

/**
 * Whether an item lives in a shared manifest.
 * @param manifestId - The item's manifest
 * @param personalManifestId - The user's personal manifest
 */
function isShared(manifestId: string, personalManifestId: string | null): boolean {
  return !!personalManifestId && manifestId.toLowerCase() !== personalManifestId.toLowerCase();
}

/**
 * Summarize a bulk move of the selected items into `target`.
 * @param items - The selected items
 * @param target - The folder to move into, or null for the top level of the personal manifest
 * @param personalManifestId - The user's personal manifest
 * @returns What the move changes
 */
export function describeBulkMove(items: SelectedItem[], target: FolderRef | null, personalManifestId: string | null): BulkMoveSummary {
  const targetManifestId = target?.ManifestId ?? personalManifestId ?? '';
  const targetFolderId = target?.Id ?? null;
  const toMove = items.filter(item => !(item.ManifestId === targetManifestId && (item.FolderId ?? null) === targetFolderId)).map(item => ({ Id: item.Id, ManifestId: item.ManifestId }));
  const crossing = toMove.filter(item => item.ManifestId !== targetManifestId);

  return {
    toMove,
    toShared: crossing.length > 0 && isShared(targetManifestId, personalManifestId),
    fromShared: crossing.some(item => isShared(item.ManifestId, personalManifestId)),
  };
}

/**
 * How many of the selected items are in a shared folder, which a bulk delete removes for everyone with access.
 * @param items - The selected items
 * @param personalManifestId - The user's personal manifest
 * @returns The number of shared items
 */
export function countSharedItems(items: ItemRef[], personalManifestId: string | null): number {
  return items.filter(item => isShared(item.ManifestId, personalManifestId)).length;
}
