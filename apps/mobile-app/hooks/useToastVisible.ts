import { useSyncExternalStore } from 'react';

/*
 * Whether a toast is on screen, so a floating button can move up out of its way. AppToaster sets it from the overlay
 * sonner-native mounts only while toasts show.
 */
let isVisible = false;
const listeners = new Set<() => void>();

/**
 * Subscribe to visibility changes.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Record whether a toast is on screen.
 */
export function setToastVisible(visible: boolean): void {
  if (isVisible === visible) {
    return;
  }
  isVisible = visible;
  listeners.forEach(listener => listener());
}

/**
 * Whether a toast is on screen.
 */
export function useToastVisible(): boolean {
  return useSyncExternalStore(subscribe, () => isVisible);
}
