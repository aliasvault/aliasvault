import { Buffer } from 'buffer';

import type { Item } from '@/utils/dist/core/models/vault';
import type { FaviconTarget } from '@/utils/RustCore';
import { selectFaviconTarget, toUrlList } from '@/utils/RustCore';
import type { SqliteClient } from '@/utils/SqliteClient';
import type { WebApiService } from '@/utils/WebApiService';

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
 * Default timeout for favicon fetch operations (5 seconds).
 */
const FAVICON_FETCH_TIMEOUT_MS = 5000;

/**
 * Centralized service for favicon/logo operations.
 */
export class FaviconService {
  /**
   * Pick the URL a favicon should be fetched from.
   * @param urlValue The URL field value (single string or multi-value array)
   * @returns The target, or null when no valid URL is found.
   */
  public static async resolveTarget(urlValue: string | string[] | undefined | null): Promise<FaviconTarget | null> {
    return selectFaviconTarget(toUrlList(urlValue));
  }

  /**
   * Fetch the favicon for a resolved target from the server API.
   * Includes deduplication check and timeout handling.
   * @param target The favicon target to fetch
   * @param sqliteClient The SQLite client for deduplication check
   * @param webApi The WebAPI service for making the request
   * @param timeoutMs Optional timeout in milliseconds (default: 5000ms)
   * @returns FaviconFetchResult with success status and image data
   */
  public static async fetchFavicon(
    target: FaviconTarget,
    sqliteClient: SqliteClient,
    webApi: WebApiService,
    timeoutMs: number = FAVICON_FETCH_TIMEOUT_MS
  ): Promise<FaviconFetchResult> {
    // Check if logo already exists (deduplication)
    if (sqliteClient.logos.hasLogoForSource(target.source)) {
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
   * @returns The updated item with Logo attached (if favicon was fetched), cleared (if no usable URL), or the original item
   */
  public static async fetchAndAttachFavicon(
    item: Item,
    urlFieldValue: string | string[] | undefined | null,
    sqliteClient: SqliteClient,
    webApi: WebApiService
  ): Promise<Item> {
    const target = await FaviconService.resolveTarget(urlFieldValue);

    // No valid URL found: clear any existing logo.
    if (!target) {
      return {
        ...item,
        Logo: undefined
      };
    }

    const result = await FaviconService.fetchFavicon(target, sqliteClient, webApi);

    if (result.success && result.imageData) {
      return {
        ...item,
        Logo: result.imageData
      };
    }

    return item;
  }
}
