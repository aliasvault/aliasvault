/**
 * Item filtering via Rust WASM. See core/rust/src/credential_matcher for algorithm.
 */
import { browser } from 'wxt/browser';

import type { Item } from '@/utils/dist/core/models/vault';
import { FieldKey } from '@/utils/dist/core/models/vault';
import init, {
  filterCredentials as wasmFilterItems,
  extractDomain as wasmExtractDomain,
  extractRootDomain as wasmExtractRootDomain
} from '@/utils/dist/core/rust/aliasvault_core.js';

export enum AutofillMatchingMode {
  DEFAULT = 'default',
  URL_EXACT = 'url_exact',
  URL_SUBDOMAIN = 'url_subdomain'
}

let wasmInitPromise: Promise<void> | null = null;

/**
 * Lazy-initialize WASM on first use.
 */
async function ensureInit(): Promise<void> {
  if (!wasmInitPromise) {
    wasmInitPromise = (async (): Promise<void> => {
      const wasmUrl = (browser.runtime.getURL as (path: string) => string)('src/aliasvault_core_bg.wasm');
      const wasmBytes = await (await fetch(wasmUrl)).arrayBuffer();
      await init(wasmBytes);
    })();
  }
  return wasmInitPromise;
}

/**
 * Helper to get all field values from an item's fields array.
 * Returns an array of strings for multi-value fields.
 */
function getFieldValues(item: Item, fieldKey: string): string[] {
  const field = item.Fields?.find(f => f.FieldKey === fieldKey);
  if (!field) {
    return [];
  }
  if (Array.isArray(field.Value)) {
    return field.Value.filter(v => v && v.length > 0);
  }
  return field.Value ? [field.Value] : [];
}

/**
 * Filter items by URL/title. Returns max 3 matches.
 * Uses Rust WASM filtering logic, mapping Item fields to the expected structure.
 */
export async function filterItems(
  items: Item[],
  currentUrl: string,
  pageTitle: string,
  matchingMode: AutofillMatchingMode = AutofillMatchingMode.DEFAULT
): Promise<Item[]> {
  await ensureInit();

  // Map Items to the format expected by the WASM filter
  const result = wasmFilterItems({
    credentials: items.map(item => ({
      Id: item.Id,
      ItemName: item.Name ?? '',
      ItemUrls: getFieldValues(item, FieldKey.LoginUrl)
    })),
    current_url: currentUrl,
    page_title: pageTitle,
    matching_mode: matchingMode
  }) as { matched_ids: string[] };

  return result.matched_ids
    .map(id => items.find(item => item.Id === id))
    .filter((item): item is Item => item !== undefined);
}

/**
 * Extract domain from URL (e.g., "https://www.example.com/path" → "example.com").
 */
export async function extractDomain(url: string): Promise<string> {
  await ensureInit();
  return wasmExtractDomain(url);
}

/**
 * Extract root domain (e.g., "sub.example.co.uk" → "example.co.uk").
 */
export async function extractRootDomain(domain: string): Promise<string> {
  await ensureInit();
  return wasmExtractRootDomain(domain);
}
