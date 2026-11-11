import { useCallback, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { LocalPreferencesService } from '@/services/LocalPreferencesService';
import NativeVaultManager from '@/specs/NativeVaultManager';

/*
 * Whether the user hid the email list next to an open email, stored per device. Loaded together with the layout preference,
 * so the emails tab mounts in its final layout.
 */
let emailListHidden = false;
const hiddenListeners = new Set<() => void>();

/**
 * Stores the value in memory and notifies the subscribers.
 */
function setEmailListHiddenValue(hidden: boolean): void {
  emailListHidden = hidden;
  hiddenListeners.forEach(listener => listener());
}

/**
 * Subscribes to changes of the email list visibility.
 */
function subscribeHidden(listener: () => void): () => void {
  hiddenListeners.add(listener);
  ensureLoaded();
  return (): void => {
    hiddenListeners.delete(listener);
  };
}

/*
 * The two-pane layout preference of a large-screen device, shared by every tab layout and the setting that changes it. It is
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
 * Loads the stored preference and email list visibility once; a failed read keeps the default.
 */
function ensureLoaded(): void {
  if (loading === null) {
    const enabled = LocalPreferencesService.getTwoPaneLayout().catch(() => true);
    const hidden = LocalPreferencesService.getEmailListHidden().catch(() => false);
    loading = Promise.all([enabled, hidden]).then(([isEnabled, isHidden]) => {
      setEmailListHiddenValue(isHidden);
      setPreference(isEnabled);
    });
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
 * The two-pane layout preference, undefined until it has loaded, and its setter, which stores it.
 */
export function useTwoPanePreference(): [boolean | undefined, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, () => preference);
  const setEnabled = useCallback((value: boolean): void => {
    setPreference(value);
    LocalPreferencesService.setTwoPaneLayout(value).catch(() => undefined);
  }, []);
  return [enabled, setEnabled];
}

/*
 * Whether this device has a large display: an iPad, or a foldable (asked natively once, so also while folded). Gates the
 * tablet and foldable-only UI options, such as the two-column layout setting, which stay visible while a foldable is folded.
 */
let largeScreenDevice: boolean = Platform.OS === 'ios' && Platform.isPad;
const deviceListeners = new Set<() => void>();
let deviceLoading: Promise<void> | null = null;

/**
 * Subscribes to the large-screen device flag, asking the native layer once whether the device is foldable.
 */
function subscribeDevice(listener: () => void): () => void {
  deviceListeners.add(listener);
  if (deviceLoading === null) {
    deviceLoading = NativeVaultManager.isFoldable().catch(() => false).then(foldable => {
      if (foldable && !largeScreenDevice) {
        largeScreenDevice = true;
        deviceListeners.forEach(other => other());
      }
    });
  }
  return (): void => {
    deviceListeners.delete(listener);
  };
}

/**
 * Whether this device has a large display (an iPad or a foldable).
 */
export function useIsLargeScreenDeviceFlag(): boolean {
  return useSyncExternalStore(subscribeDevice, () => largeScreenDevice);
}

/**
 * Whether the user hid the email list next to an open email, and its setter, which stores it.
 */
export function useEmailListHidden(): [boolean, (hidden: boolean) => void] {
  const hidden = useSyncExternalStore(subscribeHidden, () => emailListHidden);
  const setHidden = useCallback((value: boolean): void => {
    setEmailListHiddenValue(value);
    LocalPreferencesService.setEmailListHidden(value).catch(() => undefined);
  }, []);
  return [hidden, setHidden];
}
