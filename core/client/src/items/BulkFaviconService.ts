import { ApiRequestError } from '../api/errors/ApiRequestError';
import { selectFaviconTarget } from '../rust/RustCore';
import { base64ToBytes } from '../utilities/Base64';

import type { WebApiService } from '../api/WebApiService';
import type SqliteClient from '../database/SqliteClient';
import type { FaviconTarget } from '../rust/RustCore';

/**
 * Outcome of a bulk extraction.
 */
export type BulkExtractStatus = 'completed' | 'cancelled' | 'rateLimited';

/**
 * Result of a bulk extraction: favicons keyed by source so one fetched favicon serves every item on that domain.
 */
export type BulkExtractResult = {
  favicons: Map<string, Uint8Array>;
  status: BulkExtractStatus;
};

/**
 * One entry of the server's batch response.
 */
type FaviconExtractBatchResult = {
  url: string;
  /** The image bytes, base64 encoded, or null when none could be fetched. */
  image: string | null;
};

/**
 * URLs per batch request; mirrors the server's FaviconController.MaxBatchSize.
 */
const BATCH_SIZE = 10;

/**
 * Result of re-downloading every favicon of the personal vault.
 */
export type FaviconRefreshResult = {
  status: BulkExtractStatus;
  /** The number of items whose logo changed. */
  changedItems: number;
};

/**
 * Bulk favicon extraction for imports and vault-wide refreshes. Single-item favicon logic lives in FaviconService.
 */
export class BulkFaviconService {
  /**
   * Fetch favicons for many targets in server-side batches.
   * @param webApi The WebAPI service for making the requests
   * @param targets The favicon targets
   * @param onProgress Called after each batch with the number of sources processed so far
   * @param signal Aborts the extraction between batches
   * @returns The favicons by source plus the outcome
   */
  public static async extractBulk(webApi: WebApiService, targets: FaviconTarget[], onProgress?: (processed: number) => Promise<void> | void, signal?: AbortSignal): Promise<BulkExtractResult> {
    const favicons = new Map<string, Uint8Array>();

    const urlBySource = new Map<string, string>();
    for (const target of targets) {
      if (!urlBySource.has(target.source)) {
        urlBySource.set(target.source, target.url);
      }
    }

    if (urlBySource.size === 0) {
      return { favicons, status: 'completed' };
    }

    const entries = [...urlBySource.entries()];
    let processed = 0;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      if (signal?.aborted) {
        return { favicons, status: 'cancelled' };
      }

      const chunk = entries.slice(i, i + BATCH_SIZE);
      let results: FaviconExtractBatchResult[] | undefined;
      try {
        const response = await webApi.post<{ urls: string[] }, { results?: FaviconExtractBatchResult[] }>('Favicon/ExtractBatch', { urls: chunk.map(([, url]) => url) });
        results = response?.results;
      } catch (error) {
        if (error instanceof ApiRequestError && error.statusCode === 429) {
          return { favicons, status: 'rateLimited' };
        }
        // A transport or server error fails the whole chunk; the rest continues.
        results = undefined;
      }

      if (results) {
        // Matched by index: the server echoes the URL, but the index is robust against URL normalization.
        for (let j = 0; j < results.length && j < chunk.length; j++) {
          const image = results[j].image;
          if (image) {
            favicons.set(chunk[j][0], base64ToBytes(image));
          }
        }
      }

      processed += chunk.length;
      await onProgress?.(processed);
    }

    return { favicons, status: 'completed' };
  }

  /**
   * Re-download the favicon of every item in the personal vault that shows one or none, and point each item at
   * the favicon of its current domain.
   * @param client The vault database
   * @param webApi The WebAPI service for the favicon requests
   * @param onProgress Called with the number of domains processed and the total
   * @param signal Aborts the extraction between batches
   * @returns The extraction outcome and the number of items whose logo changed
   */
  public static async refreshVaultFavicons(client: SqliteClient, webApi: WebApiService, onProgress?: (processed: number, total: number) => Promise<void> | void, signal?: AbortSignal): Promise<FaviconRefreshResult> {
    const candidates = client.logos.getFaviconRefreshCandidates();
    const assignments: { candidate: typeof candidates[number]; source: string | null }[] = [];
    const targetsBySource = new Map<string, FaviconTarget>();
    for (const candidate of candidates) {
      const target = await selectFaviconTarget(candidate.Urls);
      assignments.push({ candidate, source: target?.source ?? null });
      if (target && !targetsBySource.has(target.source)) {
        targetsBySource.set(target.source, target);
      }
    }

    const total = targetsBySource.size;
    await onProgress?.(0, total);
    const result = await BulkFaviconService.extractBulk(webApi, [...targetsBySource.values()], processed => onProgress?.(processed, total), signal);
    if (result.status === 'cancelled') {
      return { status: result.status, changedItems: 0 };
    }

    const changedItems = await client.logos.applyFaviconRefresh(assignments, result.favicons);
    return { status: result.status, changedItems };
  }
}
