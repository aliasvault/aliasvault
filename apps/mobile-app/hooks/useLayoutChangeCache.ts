import { createContext, useCallback, useContext, useState } from 'react';

/** How many screens a layout remembers. */
const MAX_ENTRIES = 8;

/** The cache of the enclosing two-pane layout, by screen; null without one. */
export const LayoutChangeCacheContext = createContext<Map<string, unknown> | null>(null);

/**
 * What screen `key` last loaded, so it starts from that instead of a loading state when a layout change remounts it.
 */
export function useLayoutChangeCache<T>(key: string): { cached: T | undefined; save: (value: T) => void } {
  const cache = useContext(LayoutChangeCacheContext);
  const [cached] = useState(() => cache?.get(key) as T | undefined);
  const save = useCallback((value: T): void => {
    if (!cache) {
      return;
    }
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > MAX_ENTRIES) {
      cache.delete(cache.keys().next().value as string);
    }
  }, [cache, key]);
  return { cached, save };
}
