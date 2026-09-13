import { BaseRepository } from '../BaseRepository';
import { ItemStatsQueries } from '../queries/ItemStatsQueries';

import type { DbOp } from '../DbOp';

/**
 * The actions whose use of an item is recorded. Each maps to its own timestamp + counter pair alongside
 * the aggregate `LastUsedAt` / `UseCount`, so a report can distinguish "filled into a page" from
 * "glanced at and copied" without a second table.
 */
export type ItemUsageAction = 'autofill' | 'copy' | 'passkey';

/** The column pair each action bumps. Closed set: nothing here is ever built from caller input. */
const ACTION_COLUMNS: Record<ItemUsageAction, { last: string; count: string }> = {
  autofill: { last: 'LastAutofilledAt', count: 'AutofillCount' },
  copy: { last: 'LastCopiedAt', count: 'CopyCount' },
  passkey: { last: 'LastPasskeyAuthAt', count: 'PasskeyAuthCount' },
};

/**
 * Per-item usage statistics.
 */
export type ItemStats = {
  LastUsedAt: string | null;
  UseCount: number;
  LastAutofilledAt: string | null;
  AutofillCount: number;
  LastCopiedAt: string | null;
  CopyCount: number;
  LastPasskeyAuthAt: string | null;
  PasskeyAuthCount: number;
};

/**
 * Repository for per-item usage statistics.
 */
export class ItemStatsRepository extends BaseRepository {
  /**
   * Record one use of an item.
   * @param itemId - The item that was used
   * @param action - What the user did with it
   * @returns True when a use was recorded, false when no such item exists
   */
  public *recordUsage(itemId: string, action: ItemUsageAction): DbOp<boolean> {
    const manifestId = yield* this.itemManifestId(itemId);
    if (!manifestId) {
      return false;
    }

    const now = this.now();
    const columns = ACTION_COLUMNS[action];

    yield* this.execute(ItemStatsQueries.INSERT_ROW, [manifestId, itemId, now, now]);
    yield* this.execute(ItemStatsQueries.forAction(columns.last, columns.count), [now, now, now, manifestId, itemId]);
    return true;
  }

  /**
   * Get one item's statistics.
   * @param itemId - The item to read
   * @returns The statistics, or null when the item has never been used
   */
  public *getForItem(itemId: string): DbOp<ItemStats | null> {
    const manifestId = yield* this.itemManifestId(itemId);
    if (!manifestId) {
      return null;
    }
    return (yield* this.query<ItemStats>(ItemStatsQueries.GET_FOR_ITEM, [manifestId, itemId]))[0] ?? null;
  }

  /**
   * Get the last-used timestamp of every item that has one, newest first.
   * @returns One entry per used item
   */
  public *getLastUsed(): DbOp<{ ManifestId: string; Id: string; LastUsedAt: string; UseCount: number }[]> {
    return yield* this.query<{ ManifestId: string; Id: string; LastUsedAt: string; UseCount: number }>(ItemStatsQueries.GET_LAST_USED_ALL);
  }

  /**
   * The manifest the given item belongs to.
   * @param itemId - The item id
   * @returns The manifest id, or null when no such item exists
   */
  private *itemManifestId(itemId: string): DbOp<string | null> {
    return (yield* this.query<{ ManifestId: string }>(ItemStatsQueries.GET_ITEM_MANIFEST, [itemId]))[0]?.ManifestId ?? null;
  }
}
