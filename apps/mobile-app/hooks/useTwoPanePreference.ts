import { useCallback, useSyncExternalStore } from 'react';

import { LocalPreferencesService } from '@/services/LocalPreferencesService';

/*
 * The two-column preference of a foldable iPhone, shared by every tab layout and the setting that changes it. It is
 * undefined until the stored value has loaded, which the first subscriber starts.
 */
let preference: boolean | undefined;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * Stores the value in memory and notifies the subscribers.
 */
function setPreference(enabled: boolean): void {
  preference = enabled;
  listeners.forEach(listener => listener());
}

/**
 * Loads the stored value once; a failed read keeps the default.
 */
function ensureLoaded(): void {
  if (loading === null) {
    loading = LocalPreferencesService.getTwoPaneLayout().then(setPreference).catch(() => setPreference(true));
  }
}

/**
 * Subscribes to changes of the preference.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureLoaded();
  return (): void => {
    listeners.delete(listener);
  };
}

/**
 * The two-column preference of a foldable iPhone, undefined until it has loaded, and its setter, which stores it.
 */
export function useTwoPanePreference(): [boolean | undefined, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, () => preference);
  const setEnabled = useCallback((value: boolean): void => {
    setPreference(value);
    LocalPreferencesService.setTwoPaneLayout(value).catch(() => undefined);
  }, []);
  return [enabled, setEnabled];
}
