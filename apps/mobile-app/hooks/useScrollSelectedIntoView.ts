import type { Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import type { HostInstance, LayoutChangeEvent, ScrollViewInstance } from 'react-native';

import { isPathSelected, useTwoPane } from '@/hooks/useTwoPane';

export type ScrollSelectedIntoView = {
  targetPath: string | null;
  onLayoutFor: (href: Href) => ((event: LayoutChangeEvent) => void) | undefined;
};

/**
 * Scrolls the row of the detail shown next to the list into the middle of the scroll view, once, when the pane appears.
 */
export function useScrollSelectedIntoView(scrollViewRef: RefObject<ScrollViewInstance | null>): ScrollSelectedIntoView {
  const { pane, selectedPath } = useTwoPane();
  const [targetPath] = useState(pane === 'primary' ? selectedPath : null);
  const doneRef = useRef(false);

  const onLayout = useCallback((event: LayoutChangeEvent): void => {
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;
    const row = event.currentTarget as HostInstance | number;
    if (typeof row === 'number') {
      return;
    }

    // One frame later, so the scroll view has applied the content size the new rows give it.
    requestAnimationFrame(() => {
      const scrollView = scrollViewRef.current;
      const content = scrollView?.getInnerViewRef();
      if (!scrollView || !content) {
        return;
      }
      scrollView.measure((_x, _y, _width, viewportHeight) => {
        row.measureLayout(content, (_rowX, rowY, _rowWidth, rowHeight) => {
          scrollView.scrollTo({ y: Math.max(0, rowY + rowHeight / 2 - viewportHeight / 2), animated: false });
        });
      });
    });
  }, [scrollViewRef]);

  const onLayoutFor = useCallback((href: Href) => (targetPath !== null && !doneRef.current && isPathSelected(targetPath, href) ? onLayout : undefined), [targetPath, onLayout]);
  return useMemo(() => ({ targetPath, onLayoutFor }), [targetPath, onLayoutFor]);
}
