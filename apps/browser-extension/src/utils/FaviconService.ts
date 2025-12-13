import { Buffer } from 'buffer';

import type { Item } from '@/utils/dist/core/models/vault';
import type { SqliteClient } from '@/utils/SqliteClient';
import type { WebApiService } from '@/utils/WebApiService';

/**
 * Result of a favicon fetch operation.
 */
export type FaviconFetchResult = {
  /** Whether a favicon was successfully fetched */
  success: boolean;
  /** The decoded favicon image data (if successful) */
  imageData?: Uint8Array;
  /** Whether the fetch was skipped because a logo already exists */
  skipped?: boolean;
  /** Error message (if failed) */
  error?: string;
};

/**
 * Default timeout for favicon fetch operations (5 seconds).
 */
const FAVICON_FETCH_TIMEOUT_MS = 5000;

/**
 * Centralized service for favicon/logo operations.
 * Handles URL normalization, deduplication, and favicon fetching.
 */
export class FaviconService {
  /**
   * Extract and normalize source domain from a URL string.
   * This matches the server-side migration logic for consistent deduplication.
   * Uses lowercase and removes www. prefix for case-insensitive matching.
   * @param urlString The URL to extract the domain from
   * @returns The normalized source domain (e.g., 'github.com'), or 'unknown' if extraction fails
   */
  public static extractSourceFromUrl(urlString: string | undefined | null): string {
    if (!urlString) {
      return 'unknown';
    }

    try {
      const url = new URL(urlString.startsWith('http') ? urlString : `https://${urlString}`);
      // Normalize hostname: lowercase and remove www. prefix
      return url.hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  }

  /**
   * Normalize a URL string for favicon fetching.
   * Prepends https:// if the URL starts with www.
   * @param url The URL to normalize
   * @returns The normalized URL, or undefined if invalid
   */
  public static normalizeUrl(url: string | undefined | null): string | undefined {
    if (!url) {
      return undefined;
    }

    const trimmed = url.trim();
    if (!trimmed) {
      return undefined;
    }

    // Check if it's a valid URL format
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('www.')) {
      return undefined;
    }

    // Prepend https:// if starts with www.
    return trimmed.startsWith('www.') ? `https://${trimmed}` : trimmed;
  }

  /**
   * Extract the first valid URL from a field value (which can be string or string[]).
   * @param urlValue The URL field value
   * @returns The first valid URL, or undefined if none found
   */
  public static extractFirstValidUrl(urlValue: string | string[] | undefined | null): string | undefined {
    if (!urlValue) {
      return undefined;
    }

    const urlList = Array.isArray(urlValue) ? urlValue : [urlValue];

    // Find the first valid URL (starts with http://, https://, or www.)
    const validUrl = urlList.find(url => {
      const trimmed = url?.trim();
      return trimmed && (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('www.'));
    });

    return FaviconService.normalizeUrl(validUrl);
  }

  /**
   * Check if a logo already exists for the given URL.
   * @param urlString The URL to check
   * @param sqliteClient The SQLite client instance
   * @returns True if a logo exists for the normalized source domain
   */
  public static hasLogoForUrl(urlString: string | undefined | null, sqliteClient: SqliteClient): boolean {
    if (!urlString) {
      return false;
    }

    const source = FaviconService.extractSourceFromUrl(urlString);
    if (source === 'unknown') {
      return false;
    }

    return sqliteClient.hasLogoForSource(source);
  }

  /**
   * Fetch favicon for a URL from the server API.
   * Includes deduplication check and timeout handling.
   * @param urlString The URL to fetch favicon for
   * @param sqliteClient The SQLite client for deduplication check
   * @param webApi The WebAPI service for making the request
   * @param timeoutMs Optional timeout in milliseconds (default: 5000ms)
   * @returns FaviconFetchResult with success status and image data
   */
  public static async fetchFavicon(
    urlString: string | undefined | null,
    sqliteClient: SqliteClient,
    webApi: WebApiService,
    timeoutMs: number = FAVICON_FETCH_TIMEOUT_MS
  ): Promise<FaviconFetchResult> {
    // Validate URL
    const normalizedUrl = FaviconService.normalizeUrl(urlString);
    if (!normalizedUrl) {
      return { success: false, error: 'Invalid URL' };
    }

    // Extract source for deduplication check
    const source = FaviconService.extractSourceFromUrl(normalizedUrl);
    if (source === 'unknown') {
      return { success: false, error: 'Could not extract domain from URL' };
    }

    // Check if logo already exists (deduplication)
    if (sqliteClient.hasLogoForSource(source)) {
      console.debug(`[Favicon] Logo already exists for source "${source}", skipping fetch`);
      return { success: false, skipped: true };
    }

    console.debug(`[Favicon] No logo found for source "${source}", fetching...`);

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Favicon extraction timed out')), timeoutMs)
      );

      // Fetch favicon from API
      const faviconPromise = webApi.get<{ image: string }>(`Favicon/Extract?url=${encodeURIComponent(normalizedUrl)}`);
      const faviconResponse = await Promise.race([faviconPromise, timeoutPromise]);

      console.debug('[Favicon] Response received:', faviconResponse?.image ? 'has image' : 'no image');

      if (faviconResponse?.image) {
        const decodedImage = Uint8Array.from(Buffer.from(faviconResponse.image, 'base64'));
        console.debug('[Favicon] Logo decoded successfully');
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
   * This is a convenience method that combines URL extraction, deduplication, and fetching.
   * @param item The item to potentially update with a logo
   * @param urlFieldValue The value of the URL field (can be string or string[])
   * @param sqliteClient The SQLite client for deduplication check
   * @param webApi The WebAPI service for making the request
   * @returns The updated item with Logo attached (if favicon was fetched), or the original item
   */
  public static async fetchAndAttachFavicon(
    item: Item,
    urlFieldValue: string | string[] | undefined | null,
    sqliteClient: SqliteClient,
    webApi: WebApiService
  ): Promise<Item> {
    const urlString = FaviconService.extractFirstValidUrl(urlFieldValue);
    if (!urlString) {
      return item;
    }

    const result = await FaviconService.fetchFavicon(urlString, sqliteClient, webApi);

    if (result.success && result.imageData) {
      return {
        ...item,
        Logo: result.imageData
      };
    }

    return item;
  }
}
