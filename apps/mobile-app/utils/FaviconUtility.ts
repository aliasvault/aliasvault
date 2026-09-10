/**
 * Typed wrapper around the native Rust core for favicon URL selection.
 */
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * The URL a favicon is fetched from, paired with the `Logos.Source` key it is stored under.
 */
export type FaviconTarget = {
  url: string;
  source: string;
};

/**
 * Read an item's URL field values in display order.
 * @param urlValue The URL field value (single string or multi-value array).
 * @returns The non-empty URLs, in order.
 */
export function toUrlList(urlValue: string | string[] | undefined | null): string[] {
  if (!urlValue) {
    return [];
  }

  const urlList = Array.isArray(urlValue) ? urlValue : [urlValue];
  return urlList.filter((url): url is string => Boolean(url?.trim()));
}

/**
 * Pick which of an item's URLs a favicon should be fetched from.
 * @param urlValue The URL field value (single string or multi-value array).
 * @returns The target, or null when no valid URL is found.
 */
export async function selectFaviconTarget(urlValue: string | string[] | undefined | null): Promise<FaviconTarget | null> {
  const urls = toUrlList(urlValue);
  if (urls.length === 0) {
    return null;
  }

  const targetJson = await NativeVaultManager.selectFaviconTarget(urls);
  return targetJson ? JSON.parse(targetJson) as FaviconTarget : null;
}
