import { BaseRepository } from '../BaseRepository';
import { StorageInsightsQueries } from '../queries/StorageInsightsQueries';

import type { DbOp } from '../DbOp';
import type { LogoKind } from '@aliasvault/models/vault';

/**
 * How many items, attachments and logos the local vault holds.
 */
export type StorageCounts = {
  ItemCount: number;
  ItemsWithAttachments: number;
  ItemsWithLogos: number;
  AttachmentCount: number;
  LogoCount: number;
};

/**
 * One attachment in the largest-attachments list.
 */
export type AttachmentSizeRow = {
  Id: string;
  Filename: string;
  SizeBytes: number;
  ItemId: string;
  ManifestId: string;
  ItemName: string | null;
  CreatedAt: string;
};

/**
 * One logo in the largest-logos list.
 */
export type LogoSizeRow = {
  Id: string;
  ManifestId: string;
  Kind: LogoKind;
  Source: string;
  Name: string | null;
  SizeBytes: number;
  ItemCount: number;
  /** An item showing this logo, to link to; null when no item uses it. */
  FirstItemId: string | null;
};

/**
 * Read-only storage statistics of the local vault, for the storage insights screen.
 */
export class StorageInsightsRepository extends BaseRepository {
  /**
   * Item, attachment and logo counts.
   * @returns The counts
   */
  public *getCounts(): DbOp<StorageCounts> {
    const row = (yield* this.query<StorageCounts>(StorageInsightsQueries.GET_COUNTS))[0];
    return row ?? { ItemCount: 0, ItemsWithAttachments: 0, ItemsWithLogos: 0, AttachmentCount: 0, LogoCount: 0 };
  }

  /**
   * The largest attachments, biggest first.
   * @param limit - The number of rows
   * @returns The attachments
   */
  public *getLargestAttachments(limit: number): DbOp<AttachmentSizeRow[]> {
    return yield* this.query<AttachmentSizeRow>(StorageInsightsQueries.GET_LARGEST_ATTACHMENTS, [limit]);
  }

  /**
   * The largest logos, biggest first.
   * @param limit - The number of rows
   * @returns The logos
   */
  public *getLargestLogos(limit: number): DbOp<LogoSizeRow[]> {
    return yield* this.query<LogoSizeRow>(StorageInsightsQueries.GET_LARGEST_LOGOS, [limit]);
  }
}
