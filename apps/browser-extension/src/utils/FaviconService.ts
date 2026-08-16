import { Buffer } from 'buffer';

import type { DraftItem } from '@/utils/db/ItemRef';
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
   * Accepts a scheme-less host ('github.com', 'www.github.com/login') and prepends https://, matching
   * what extractSourceFromUrl accepts: a URL we store a logo Source for must also be one we fetch for.
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

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }

    // A bare host: at least two dot-separated labels, optionally followed by a port and/or a path.
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(trimmed) ? `https://${trimmed}` : undefined;
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

    return urlList.map(url => FaviconService.normalizeUrl(url)).find(url => url !== undefined);
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

    return sqliteClient.logos.hasFaviconForSource(source);
  }

  /**
   * The icon the vault already holds for this URL's domain, if any.
   * @param urlString The URL to look an icon up for
   * @param sqliteClient The SQLite client instance
   * @returns The stored icon bytes, or null when the vault holds none
   */
  public static getStoredFavicon(urlString: string | undefined | null, sqliteClient: SqliteClient): Uint8Array | null {
    const source = FaviconService.extractSourceFromUrl(urlString);
    return source === 'unknown' ? null : sqliteClient.logos.getFaviconData(source);
  }

  /**
   * Fetch favicon for a URL from the server API.
   * @param urlString The URL to fetch favicon for
   * @param sqliteClient The SQLite client for deduplication check
   * @param webApi The WebAPI service for making the request
   * @param options Optional fetch options
   * @returns FaviconFetchResult with success status and image data
   */
  public static async fetchFavicon(
    urlString: string | undefined | null,
    sqliteClient: SqliteClient,
    webApi: WebApiService,
    options: FaviconFetchOptions = {}
  ): Promise<FaviconFetchResult> {
    const timeoutMs = options.timeoutMs ?? FAVICON_FETCH_TIMEOUT_MS;
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
    if (!options.ignoreStored && sqliteClient.logos.hasFaviconForSource(source)) {
      return { success: false, skipped: true };
    }

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Favicon extraction timed out')), timeoutMs)
      );

      // Fetch favicon from API
      const faviconPromise = webApi.get<{ image: string }>(`Favicon/Extract?url=${encodeURIComponent(normalizedUrl)}`);
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
   * This is a convenience method that combines URL extraction, deduplication, and fetching.
   * If the URL is empty or invalid, clears any existing logo from the item.
   * @param item The item to potentially update with a logo
   * @param urlFieldValue The value of the URL field (can be string or string[])
   * @param sqliteClient The SQLite client for deduplication check
   * @param webApi The WebAPI service for making the request
   * @returns The updated item with Logo attached (if favicon was fetched), cleared (if URL is empty), or the original item
   */
  public static async fetchAndAttachFavicon(
    item: DraftItem,
    urlFieldValue: string | string[] | undefined | null,
    sqliteClient: SqliteClient,
    webApi: WebApiService
  ): Promise<DraftItem> {
    const urlString = FaviconService.extractFirstValidUrl(urlFieldValue);

    // If URL is empty or invalid, explicitly clear logo to signal that any existing logo should be removed
    if (!urlString) {
      return {
        ...item,
        Logo: undefined
      };
    }

    const result = await FaviconService.fetchFavicon(urlString, sqliteClient, webApi);

    return {
      ...item,
      Logo: result.success ? result.imageData : undefined
    };
  }
}
