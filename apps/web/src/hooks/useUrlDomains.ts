import { urlsOf, type UrlDomain } from '@aliasvault/client/items/MergeSuggestions';
import { extractDomain, extractRootDomain } from '@aliasvault/client/rust/RustCore';
import { useEffect, useState } from 'react';

import type { Item } from '@aliasvault/models/vault';

/**
 * The host and registrable domain of every URL of the given items, keyed by URL; null until resolved.
 * @param items - The items whose URLs to resolve
 * @returns The domains by URL
 */
export function useUrlDomains(items: Item[]): Map<string, UrlDomain> | null {
  const [urlDomains, setUrlDomains] = useState<Map<string, UrlDomain> | null>(null);

  useEffect(() => {
    let cancelled = false;
    /**
     * Resolve the URLs one by one through the Rust core.
     */
    const resolve = async (): Promise<void> => {
      const resolved = new Map<string, UrlDomain>();
      for (const url of new Set(items.flatMap(urlsOf))) {
        const host = await extractDomain(url);
        if (host) {
          resolved.set(url, { host, root: await extractRootDomain(host) });
        }
      }
      if (!cancelled) {
        setUrlDomains(resolved);
      }
    };
    resolve().catch(error => {
      console.error('Error resolving the domains of item URLs:', error);
      if (!cancelled) {
        setUrlDomains(new Map());
      }
    });
    return (): void => {
      cancelled = true;
    };
  }, [items]);

  return urlDomains;
}
