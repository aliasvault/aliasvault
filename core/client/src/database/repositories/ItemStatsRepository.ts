import { BaseRepository } from '../BaseRepository';
import { ItemStatsQueries } from '../queries/ItemStatsQueries';

import type { DbOp } from '../DbOp';
import type { ItemRef } from '../ItemRef';

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
   * @param item - The item that was used, named by its manifest and id
   * @param action - What the user did with it
   * @returns True when a use was recorded, false when no such item exists
   */
  public *recordUsage(item: ItemRef, action: ItemUsageAction): DbOp<boolean> {
    if ((yield* this.query<{ Found: number }>(ItemStatsQueries.ITEM_EXISTS, [item.Id, item.ManifestId])).length === 0) {
      return false;
    }

    const now = this.now();
    const columns = ACTION_COLUMNS[action];

    yield* this.execute(ItemStatsQueries.INSERT_ROW, [item.ManifestId, item.Id, now, now]);
    yield* this.execute(ItemStatsQueries.forAction(columns.last, columns.count), [now, now, now, item.ManifestId, item.Id]);
    return true;
  }
}
