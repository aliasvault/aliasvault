import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import type { RefObject } from 'react';

/**
 * Coming back to a list within this time after leaving it returns to where it was scrolled.
 */
const RESTORE_WINDOW_MS = 60_000;

/**
 * Where a list was scrolled when the user left it (no offset when at the top), and the row opened then.
 */
type ListPosition = { offset: number | null; openedRow: string | null; rowCount: number; leftAt: number };

/**
 * Positions of the lists left recently, by list key. Kept in memory, so they last as long as the popup is open.
 */
const positions = new Map<string, ListPosition>();

type ListScrollRestoreOptions = {
  key: string;
  isReady: boolean;
  canRestore: boolean;
  rowsRef: RefObject<HTMLElement | null>;
  rowCount?: number;
  totalRows?: number;
  renderRows?: (count: number) => void;
};

type ListScrollRestore = {
  openedRow: string | null;
  rememberOpenedRow: (rowKey: string) => void;
};

/**
 * How long after restoring a position the rows are held there while content above them appears.
 */
const SETTLE_MS = 1000;

/**
 * Input that scrolls the list, which ends holding the rows in place.
 */
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * How far the container is scrolled past the top of the rows.
 */
function offsetOf(rows: HTMLElement, container: HTMLElement): number {
  return container.getBoundingClientRect().top - rows.getBoundingClientRect().top;
}

/**
 * Scroll the rows to `offset` and hold them there for a moment; returns a function that stops holding.
 */
function holdRowsAt(rowsRef: RefObject<HTMLElement | null>, offset: number): () => void {
  const until = performance.now() + SETTLE_MS;
  let frame = 0;
  /**
   * Stop holding the rows.
   */
  const stop = (): void => {
    cancelAnimationFrame(frame);
    USER_SCROLL_EVENTS.forEach(type => window.removeEventListener(type, stop, true));
  };
  /**
   * Move the rows back to the offset when content above them has pushed them away.
   */
  const step = (): void => {
    const rows = rowsRef.current;
    const container = rows?.closest('main');
    if (rows && container) {
      const delta = offset - offsetOf(rows, container);
      if (Math.abs(delta) >= 1) {
        container.scrollTop += delta;
      }
    }
    if (performance.now() < until) {
      frame = requestAnimationFrame(step);
    } else {
      stop();
    }
  };
  USER_SCROLL_EVENTS.forEach(type => window.addEventListener(type, stop, { capture: true, passive: true }));
  // Start on the next frame, after the layout has reset the scroll position for the new route.
  frame = requestAnimationFrame(step);
  return stop;
}

/**
 * Return to the scroll position a list had when the user comes back to it shortly after leaving, for example with the
 * back button after opening an item. A page that renders all its rows at once leaves out rowCount, totalRows and renderRows.
 */
export function useListScrollRestore({ key, isReady, canRestore, rowsRef, rowCount = 0, totalRows = 0, renderRows }: ListScrollRestoreOptions): ListScrollRestore {
  const { pathname } = useLocation();
  const [openedRow, setOpenedRow] = useState<string | null>(null);
  const offsetRef = useRef<number | null>(null);
  const openedRowRef = useRef<string | null>(null);
  const committedRef = useRef({ key, rowCount });
  const pendingRef = useRef<ListPosition | null>(null);
  const attemptsRef = useRef(0);
  const stopHoldingRef = useRef<() => void>(() => undefined);

  /*
   * Follow the position as it changes.
   */
  useEffect(() => {
    const container = isReady ? rowsRef.current?.closest('main') : null;
    if (!container) {
      return undefined;
    }
    /**
     * Record the current position, or none when the list is at the top.
     */
    const onScroll = (): void => {
      const rows = rowsRef.current;
      offsetRef.current = rows && container.scrollTop > 0 ? offsetOf(rows, container) : null;
    };
    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    return (): void => container.removeEventListener('scroll', onScroll);
  }, [isReady, rowsRef]);

  // Arriving at a route: pick up a recent position of this list. Leaving it: remember the position.
  useLayoutEffect(() => {
    const saved = positions.get(key);
    pendingRef.current = canRestore && saved && Date.now() - saved.leftAt <= RESTORE_WINDOW_MS ? saved : null;
    attemptsRef.current = 0;
    openedRowRef.current = null;
    setOpenedRow(pendingRef.current?.openedRow ?? null);
    if (saved && !pendingRef.current) {
      positions.delete(key);
    }
    return (): void => {
      stopHoldingRef.current();
      const left = committedRef.current;
      if (offsetRef.current !== null || openedRowRef.current !== null) {
        positions.set(left.key, { offset: offsetRef.current, openedRow: openedRowRef.current, rowCount: left.rowCount, leftAt: Date.now() });
      }
    };
    // Only a route change arrives or leaves; a new search or filter on the same route does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Render the rows the position needs, then scroll to it once the page has settled.
  useLayoutEffect(() => {
    committedRef.current = { key, rowCount };
    const pending = pendingRef.current;
    if (!pending || !isReady) {
      return;
    }
    if (renderRows && rowCount < Math.min(pending.rowCount, totalRows) && attemptsRef.current < 5) {
      attemptsRef.current++;
      renderRows(pending.rowCount);
      return;
    }
    pendingRef.current = null;
    positions.delete(key);
    if (pending.offset !== null) {
      stopHoldingRef.current = holdRowsAt(rowsRef, pending.offset);
    }
  });

  const rememberOpenedRow = useCallback((rowKey: string): void => {
    openedRowRef.current = rowKey;
  }, []);

  return { openedRow, rememberOpenedRow };
}
