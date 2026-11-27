import { router } from 'expo-router';

/**
 * A field value shown on the fullscreen value screen.
 */
export type FullscreenValue = {
  value: string;
  /** Show the value as numbered character cells, for reading a password out loud or typing it over. */
  showCharacters: boolean;
};

let current: FullscreenValue | null = null;

/**
 * Show a field value full screen, titled with the field label.
 */
export function openFullscreenValue(label: string, value: FullscreenValue): void {
  current = value;
  router.push({ pathname: '/fullscreen-value', params: { title: label } });
}

/**
 * The value the fullscreen value screen shows.
 */
export function getFullscreenValue(): FullscreenValue | null {
  return current;
}

/**
 * Forget the value once its screen is closed.
 */
export function clearFullscreenValue(): void {
  current = null;
}
