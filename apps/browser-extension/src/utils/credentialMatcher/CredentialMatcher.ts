/**
 * Credential filtering via Rust WASM. See core/rust/src/credential_matcher for algorithm.
 */
import { browser } from 'wxt/browser';

import type { Credential } from '@/utils/dist/core/models/vault';
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
 * Filter credentials by URL/title. Returns max 3 matches.
 */
export async function filterCredentials(
  credentials: Credential[],
  currentUrl: string,
  pageTitle: string,
  matchingMode: AutofillMatchingMode = AutofillMatchingMode.DEFAULT
): Promise<Credential[]> {
  await ensureInit();

  const result = wasmFilterCredentials({
    credentials: credentials.map(c => ({ Id: c.Id, ServiceName: c.ServiceName, ServiceUrl: c.ServiceUrl })),
    current_url: currentUrl,
    page_title: pageTitle,
    matching_mode: matchingMode
  }) as { matched_ids: string[] };

  return result.matched_ids
    .map(id => credentials.find(c => c.Id === id))
    .filter((c): c is Credential => c !== undefined);
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
