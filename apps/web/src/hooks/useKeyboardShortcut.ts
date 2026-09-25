import { useEffect } from 'react';

/** How long the first key of a two-key chord stays armed. */
const CHORD_TIMEOUT_MS = 1000;

/**
 * Whether the keyboard focus is in a text field, where chords must not fire.
 */
const isTypingTarget = (): boolean => {
  const element = document.activeElement;
  if (!element) {
    return false;
  }
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (element as HTMLElement).isContentEditable;
};

/**
 * Register a two-key chord such as "gc".
 * @param chord - the two keys, e.g. 'gc'
 * @param handler - what to run when the chord is pressed
 */
export function useKeyboardShortcut(chord: string, handler: () => void): void {
  useEffect(() => {
    let firstKeyAt: number | null = null;
    const [first, second] = chord.split('');

    /**
     * Track the chord.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget()) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === first && (firstKeyAt === null || Date.now() - firstKeyAt > CHORD_TIMEOUT_MS)) {
        firstKeyAt = Date.now();
        return;
      }
      if (key === second && firstKeyAt !== null && Date.now() - firstKeyAt <= CHORD_TIMEOUT_MS) {
        firstKeyAt = null;
        event.preventDefault();
        handler();
        return;
      }
      firstKeyAt = null;
    };

    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [chord, handler]);
}
