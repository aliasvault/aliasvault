/**
 * Typed wrapper around the AliasVault Rust core (shared with iOS, Android,
 * and the Blazor client). The browser ships the core as WebAssembly; that
 * detail is encapsulated here so callers can think in terms of plain
 * TypeScript functions.
 *
 * Algorithms (URL matching, credential filtering, domain extraction) live in
 * `core/rust/src/credential_matcher`. This file only handles init and
 * adapts inputs/outputs to TypeScript types.
 */
import { browser } from 'wxt/browser';

import type { Item } from '@/utils/dist/core/models/vault';
import { FieldKey } from '@/utils/dist/core/models/vault';
import initWasm, * as core from '@/utils/dist/core/rust/aliasvault_core.js';

export enum AutofillMatchingMode {
  DEFAULT = 'default',
  URL_EXACT = 'url_exact',
  URL_SUBDOMAIN = 'url_subdomain'
}

let initPromise: Promise<void> | null = null;

/**
 * Initialize the Rust core. Safe to call multiple times — subsequent calls
 * return the same in-flight promise. Callers that want to pay the WASM load
 * cost up front (e.g. background startup) can `await initRustCore()` once;
 * everything else lazily inits on first use.
 */
export function initRustCore(): Promise<void> {
  if (!initPromise) {
    initPromise = (async (): Promise<void> => {
      const wasmUrl = (browser.runtime.getURL as (path: string) => string)('src/aliasvault_core_bg.wasm');
      const wasmBytes = await (await fetch(wasmUrl)).arrayBuffer();
      await initWasm(wasmBytes);
    })();
  }
  return initPromise;
}

/**
 * Extract the host (subdomain + domain) from a URL.
 * Example: `https://www.example.com/path` → `example.com`.
 * Returns empty string for inputs the Rust extractor rejects, e.g.
 * reversed-TLD app bundle identifiers like `com.example.app`.
 */
export async function extractDomain(url: string): Promise<string> {
  await initRustCore();
  return core.extractDomain(url);
}

/**
 * Extract the root domain.
 * Example: `sub.example.co.uk` → `example.co.uk`.
 */
export async function extractRootDomain(domain: string): Promise<string> {
  await initRustCore();
  return core.extractRootDomain(domain);
}

/**
 * Filter items by URL/title for autofill. Returns at most 3 matches.
 */
export async function filterItems(
  items: Item[],
  currentUrl: string,
  pageTitle: string,
  matchingMode: AutofillMatchingMode = AutofillMatchingMode.DEFAULT
): Promise<Item[]> {
  await initRustCore();

  const credentials = items.map(item => ({
    Id: item.Id,
    ItemName: item.Name ?? '',
    ItemUrls: getFieldValues(item, FieldKey.LoginUrl)
  }));

  const result = core.filterCredentials({
    credentials,
    current_url: currentUrl,
    page_title: pageTitle,
    matching_mode: matchingMode
  }) as { matched_ids: string[] };

  return result.matched_ids
    .map(id => items.find(item => item.Id === id))
    .filter((item): item is Item => item !== undefined);
}

/**
 * True if `newUrl` is already represented in `existingUrls` under
 * host-only comparison (scheme, `www.`, path, query, fragment, trailing
 * slash all ignored). Falls back to lowercased exact-match when the Rust
 * extractor returns no domain (app bundle identifiers).
 *
 * Performs one async init, then a synchronous loop — Rust core calls are
 * sync once WASM is loaded.
 */
export async function isUrlAlreadyLinked(existingUrls: string[], newUrl: string): Promise<boolean> {
  await initRustCore();
  const newKey = urlComparisonKey(newUrl);
  if (!newKey) {
    return false;
  }
  return existingUrls.some(existing => urlComparisonKey(existing) === newKey);
}

/**
 * Synchronous host-only comparison key. Caller must ensure `initRustCore()`
 * has resolved before calling. Exposed as a sync helper for tight loops
 * (see `isUrlAlreadyLinked`); async callers should use `extractDomain`.
 */
function urlComparisonKey(url: string): string {
  const trimmed = url.trim().toLowerCase();
  if (!trimmed) {
    return trimmed;
  }
  const domain = core.extractDomain(trimmed);
  return domain.length > 0 ? domain : trimmed;
}

/**
 * Read all non-empty values for a field key from an item, returning them as
 * a string array (single-value fields are wrapped to a 1-element array).
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
