import { selectFaviconTarget, toUrlList } from '../rust/RustCore';
import { base64ToBytes } from '../utilities/Base64';
import { logExpected } from '../utilities/Diagnostics';

import type { FaviconTarget } from '../rust/RustCore';
import type { Item } from '@aliasvault/models/vault';

/**
 * A value a host's repository view returns directly (sync view) or as a promise (async view).
 */
type MaybePromise<T> = T | Promise<T>;

/**
 * The favicon lookups this service needs from the vault, satisfied by both views of the logo repository.
 */
export type FaviconStore = {
  hasFaviconForSource(source: string): MaybePromise<boolean>;
  getFaviconData(source: string): MaybePromise<Uint8Array | null>;
};

/**
 * The part of the API client the favicon fetch needs.
 */
export type FaviconApi = {
  post<TRequest, TResponse>(endpoint: string, data: TRequest): Promise<TResponse>;
};

/**
 * Result of a favicon fetch.
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
  /** Fetch even when the vault already holds a favicon for the domain (an explicit re-fetch). */
  ignoreStored?: boolean;

  /** Timeout in milliseconds (default: 5000ms). */
  timeoutMs?: number;
};

/**
 * Default timeout of a favicon fetch.
 */
const FAVICON_FETCH_TIMEOUT_MS = 5000;

/**
 * Favicon lookup and fetching, shared by every client.
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
   * @param logos The vault's logo repository
   * @returns The stored icon bytes, or null when the vault holds none
   */
  public static async getStoredFavicon(target: FaviconTarget | null, logos: FaviconStore): Promise<Uint8Array | null> {
    return target ? logos.getFaviconData(target.source) : null;
  }

  /**
   * Fetch the favicon of a resolved target from the server, unless the vault already holds one for its domain.
   * @param target The favicon target to fetch
   * @param logos The vault's logo repository
   * @param webApi The API client
   * @param options Optional fetch options
   */
  public static async fetchFavicon(target: FaviconTarget, logos: FaviconStore, webApi: FaviconApi, options: FaviconFetchOptions = {}): Promise<FaviconFetchResult> {
    const timeoutMs = options.timeoutMs ?? FAVICON_FETCH_TIMEOUT_MS;

    if (!options.ignoreStored && await logos.hasFaviconForSource(target.source)) {
      return { success: false, skipped: true };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Favicon extraction timed out')), timeoutMs);
      });

      const faviconPromise = webApi.post<{ url: string }, { image: string }>('Favicon/Extract', { url: target.url });
      const faviconResponse = await Promise.race([faviconPromise, timeoutPromise]);

      if (faviconResponse?.image) {
        return { success: true, imageData: base64ToBytes(faviconResponse.image) };
      }

      return { success: false, error: 'No favicon returned from server' };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logExpected('[Favicon] Extracting the favicon failed', errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The item with the favicon of its URL as Logo, or without a Logo when none was fetched.
   * @param item The item to update
   * @param urlFieldValue The value of the URL field (single string or multi-value array)
   * @param logos The vault's logo repository
   * @param webApi The API client
   */
  public static async fetchAndAttachFavicon(item: Item, urlFieldValue: string | string[] | undefined | null, logos: FaviconStore, webApi: FaviconApi): Promise<Item> {
    const target = await FaviconService.resolveTarget(urlFieldValue);
    if (!target) {
      return { ...item, Logo: undefined };
    }

    const result = await FaviconService.fetchFavicon(target, logos, webApi);
    return { ...item, Logo: result.success ? result.imageData : undefined };
  }
}
