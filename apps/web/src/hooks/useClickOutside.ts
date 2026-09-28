import { useEffect, type RefObject } from 'react';

/**
 * Call `onClose` when a mouse click lands outside every given element.
 * @param refs - the elements that count as "inside"
 * @param onClose - what to do on an outside click
 * @param enabled - whether to listen at all
 */
export function useClickOutside(refs: RefObject<HTMLElement | null>[], onClose: () => void, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    /**
     * Close when the click target is not inside any of the elements.
     */
    const handleClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (refs.some(ref => ref.current?.contains(target))) {
        return;
      }
      onClose();
    };

    document.addEventListener('mousedown', handleClick);
    return (): void => document.removeEventListener('mousedown', handleClick);
  }, [refs, onClose, enabled]);
}
