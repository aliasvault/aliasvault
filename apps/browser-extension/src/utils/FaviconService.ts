import { Buffer } from 'buffer';

import { selectFaviconTarget, toUrlList } from '@aliasvault/client/rust/RustCore';

import type { WebApiService } from '@aliasvault/client/api/WebApiService';
import type { DraftItem } from '@aliasvault/client/database/ItemRef';
import type { SqliteClient } from '@aliasvault/client/database/SqliteClient';
import type { FaviconTarget } from '@aliasvault/client/rust/RustCore';

/**
 * Result of a favicon fetch operation.
 */
export type FaviconFetchResult = {
  success: boolean;
  imageData?: Uint8Array;
  skipped?: boolean;
  error?: string;
};

/**
 * Options for a favicon fetch.
 */
export type FaviconFetchOptions = {
  /**
   * Fetch even when the vault already holds a favicon for the domain. Set for an explicit re-fetch,
   * where the point is to replace a favicon that has gone stale.
   */
  ignoreStored?: boolean;

  /** Timeout in milliseconds (default: 5000ms). */
  timeoutMs?: number;
};

/**
 * Default timeout for favicon fetch operations (5 seconds).
 */
const FAVICON_FETCH_TIMEOUT_MS = 5000;

/**
 * Centralized service for favicon/logo operations.
 */
export class FaviconService {
  /**
   * Pick the URL a favicon should be fetched from, and the Source key it is stored under.
   * @param urlValue The URL field value (single string or multi-value array)
   * @returns The target, or null when no valid URL is found.
   */
  public static async resolveTarget(urlValue: string | string[] | undefined | null): Promise<FaviconTarget | null> {
    return selectFaviconTarget(toUrlList(urlValue));
  }

  /**
   * The icon the vault already holds for this target's domain, if any.
   * @param target The favicon target to look an icon up for
   * @param sqliteClient The SQLite client instance
   * @returns The stored icon bytes, or null when the vault holds none
   */
  public static getStoredFavicon(target: FaviconTarget | null, sqliteClient: SqliteClient): Uint8Array | null {
    return target ? sqliteClient.logos.getFaviconData(target.source) : null;
  }

  /**
   * Fetch the favicon for a resolved target from the server API.
   * Includes deduplication check and timeout handling.
   * @param target The favicon target to fetch
   * @param sqliteClient The SQLite client for deduplication check
   * @param webApi The WebAPI service for making the request
   * @param options Optional fetch options
   * @returns FaviconFetchResult with success status and image data
   */
  public static async fetchFavicon(
    target: FaviconTarget,
    sqliteClient: SqliteClient,
    webApi: WebApiService,
    options: FaviconFetchOptions = {}
  ): Promise<FaviconFetchResult> {
    const timeoutMs = options.timeoutMs ?? FAVICON_FETCH_TIMEOUT_MS;

    // Check if logo already exists (deduplication)
    if (!options.ignoreStored && sqliteClient.logos.hasFaviconForSource(target.source)) {
      return { success: false, skipped: true };
    }

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Favicon extraction timed out')), timeoutMs)
      );

      // Fetch favicon from API
      const faviconPromise = webApi.get<{ image: string }>(`Favicon/Extract?url=${encodeURIComponent(target.url)}`);
      const faviconResponse = await Promise.race([faviconPromise, timeoutPromise]);

      if (faviconResponse?.image) {
        const decodedImage = Uint8Array.from(Buffer.from(faviconResponse.image, 'base64'));
        return { success: true, imageData: decodedImage };
      }

      return { success: false, error: 'No favicon returned from server' };
    } catch (err) {
      // Favicon extraction failed or timed out - not critical
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Favicon] Error extracting favicon:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Fetch and attach favicon to an item if needed.
   * This is a convenience method that combines URL selection, deduplication, and fetching.
   * If no valid URL is found, clears any existing logo from the item.
   * @param item The item to potentially update with a logo
   * @param urlFieldValue The value of the URL field (can be string or string[])
   * @param sqliteClient The SQLite client for deduplication check
   * @param webApi The WebAPI service for making the request
   * @returns The updated item with Logo attached (if favicon was fetched), or cleared when nothing was fetched
   */
  public static async fetchAndAttachFavicon(
    item: DraftItem,
    urlFieldValue: string | string[] | undefined | null,
    sqliteClient: SqliteClient,
    webApi: WebApiService
  ): Promise<DraftItem> {
    const target = await FaviconService.resolveTarget(urlFieldValue);

    // No valid URL found: clear any existing logo.
    if (!target) {
      return {
        ...item,
        Logo: undefined
      };
    }

    const result = await FaviconService.fetchFavicon(target, sqliteClient, webApi);

    return {
      ...item,
      Logo: result.success ? result.imageData : undefined
    };
  }
}
