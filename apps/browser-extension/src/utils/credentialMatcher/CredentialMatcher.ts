/**
 * Item filtering via Rust WASM. See core/rust/src/credential_matcher for algorithm.
 */
import { browser } from 'wxt/browser';

import type { Credential, Item } from '@/utils/dist/core/models/vault';
import { FieldKey } from '@/utils/dist/core/models/vault';
import init, {
  filterCredentials as wasmFilterCredentials,
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
 * Helper to get field value from an item's fields array.
 */
function getFieldValue(item: Item, fieldKey: string): string | undefined {
  const field = item.Fields?.find(f => f.FieldKey === fieldKey);
  if (!field) {
    return undefined;
  }
  return Array.isArray(field.Value) ? field.Value[0] : field.Value;
}

/**
 * Filter items by URL/title. Returns max 3 matches.
 * Uses the same Rust WASM filtering logic but maps Item fields to the expected structure.
 */
export async function filterItems(
  items: Item[],
  currentUrl: string,
  pageTitle: string,
  matchingMode: AutofillMatchingMode = AutofillMatchingMode.DEFAULT
): Promise<Item[]> {
  await ensureInit();

  // Map Items to the format expected by the WASM filter
  const result = wasmFilterCredentials({
    credentials: items.map(item => ({
      Id: item.Id,
      ServiceName: item.Name ?? '',
      ServiceUrl: getFieldValue(item, FieldKey.LoginUrl)
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

/**
 * Filter credentials by URL/title. Returns max 3 matches.
 * Uses the same Rust WASM filtering logic with the Credential type.
 */
export async function filterCredentials(
  credentials: Credential[],
  currentUrl: string,
  pageTitle: string,
  matchingMode: AutofillMatchingMode = AutofillMatchingMode.DEFAULT
): Promise<Credential[]> {
  await ensureInit();

  const result = wasmFilterCredentials({
    credentials: credentials.map(cred => ({
      Id: cred.Id,
      ServiceName: cred.ServiceName ?? '',
      ServiceUrl: cred.ServiceUrl
    })),
    current_url: currentUrl,
    page_title: pageTitle,
    matching_mode: matchingMode
  }) as { matched_ids: string[] };

  return result.matched_ids
    .map(id => credentials.find(cred => cred.Id === id))
    .filter((cred): cred is Credential => cred !== undefined);
}
