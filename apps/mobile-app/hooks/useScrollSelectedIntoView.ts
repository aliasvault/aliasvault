import type { Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { HostInstance, LayoutChangeEvent, ScrollViewInstance } from 'react-native';

import { isPathSelected, useTwoPane } from '@/hooks/useTwoPane';

/*
 * When the primary pane appears (folding phone is unfolded), these hooks scroll the row of the detail shown next to the list
 * into the middle of it, once. Which one a screen uses depends on its list:
 * - useScrollSelectedIntoFlatList: a long, data-driven FlatList (items, folders, emails), which only renders the rows near
 *   the visible area, so it scrolls by index.
 * - useScrollSelectedIntoScrollView: a short, fixed ScrollView (settings), which renders every row, so it measures the row.
 */

/**
 * The detail shown next to the list when the pane appears, captured once; null outside the primary pane.
 */
function useScrollTargetPath(): string | null {
  const { pane, selectedPath } = useTwoPane();
  const [targetPath] = useState(pane === 'primary' ? selectedPath : null);
  return targetPath;
}

const INITIAL_RENDER_COUNT = 14;
const MAX_RENDERED_TO_SELECTED = 500;
const MAX_SCROLL_RETRIES = 30;
const SETTLE_DURATION = 3000;
const MAINTAIN_VISIBLE_POSITION = { minIndexForVisible: 0 };

/** The scroll methods of a FlatList. */
type ScrollableList = {
  scrollToIndex: (params: { index: number; viewPosition?: number; animated?: boolean }) => void;
  scrollToOffset: (params: { offset: number; animated?: boolean }) => void;
};

type FlatListOptions<Row> = {
  rows: readonly Row[];
  isLoaded: boolean;
  rowHref: (row: Row) => Href;
  rowKey: (row: Row) => string;
};

export type ScrollSelectedIntoFlatList = {
  targetPath: string | null;
  listKey: string;
  listProps: {
    initialNumToRender: number;
    maintainVisibleContentPosition?: { minIndexForVisible: number };
    onScrollToIndexFailed: (info: { index: number; averageItemLength: number }) => void;
  };
  onListHeaderLayout: (event: LayoutChangeEvent) => void;
  scrollToIndex: (index: number, animated: boolean) => void;
};

/**
 * Scrolls the selected row of a FlatList into view. A FlatList only scrolls to a row exactly once every row above it is
 * measured, so it mounts again with those rows rendered (up to a cap). The target is kept by key, as a restored search or
 * sort may still reorder the rows.
 */
export function useScrollSelectedIntoFlatList<Row>(listRef: RefObject<ScrollableList | null>, { rows, isLoaded, rowHref, rowKey }: FlatListOptions<Row>): ScrollSelectedIntoFlatList {
  const targetPath = useScrollTargetPath();
  const targetDoneRef = useRef(false);
  const retriesRef = useRef(0);
  const listHeaderHeightRef = useRef(0);
  const isLoadedRef = useRef(isLoaded);
  isLoadedRef.current = isLoaded;
  const scrolledRef = useRef(false);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [isSettling, setIsSettling] = useState(false);

  useEffect(() => {
    if (targetPath === null || targetDoneRef.current || !isLoaded) {
      return;
    }
    targetDoneRef.current = true;
    const selected = rows.find(row => isPathSelected(targetPath, rowHref(row)));
    if (selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- runs once, after the first load in the primary pane
      setTargetKey(rowKey(selected));
    }
  }, [targetPath, isLoaded, rows, rowHref, rowKey]);

  const targetIndex = useMemo(() => (targetKey === null ? -1 : rows.findIndex(row => rowKey(row) === targetKey)), [targetKey, rows, rowKey]);

  const scrollToIndex = useCallback((index: number, animated: boolean): void => {
    retriesRef.current = 0;
    if (isLoadedRef.current) {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated });
    }
  }, [listRef]);

  useEffect(() => {
    if (targetIndex <= 0 || !isLoaded || scrolledRef.current) {
      return;
    }
    // While the rows above settle, keep the visible rows in place instead of letting their real heights shift them.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- toggles a list prop for the duration of the scroll
    setIsSettling(true);
    const frame = requestAnimationFrame(() => {
      if (isLoadedRef.current) {
        scrolledRef.current = true;
        scrollToIndex(targetIndex, false);
      }
    });
    let isSettled = false;
    const settle = setTimeout(() => {
      isSettled = true;
      setIsSettling(false);
    }, SETTLE_DURATION);
    return (): void => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      setIsSettling(false);
      // A reload before the rows settled shows placeholder rows, which drops the scroll position: scroll again once loaded.
      if (!isSettled) {
        scrolledRef.current = false;
      }
    };
  }, [targetIndex, isLoaded, scrollToIndex]);

  const onScrollToIndexFailed = useCallback(({ index, averageItemLength }: { index: number; averageItemLength: number }): void => {
    listRef.current?.scrollToOffset({ offset: listHeaderHeightRef.current + index * averageItemLength, animated: false });
    if (retriesRef.current >= MAX_SCROLL_RETRIES) {
      return;
    }
    retriesRef.current++;
    setTimeout(() => {
      if (isLoadedRef.current) {
        listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
      }
    }, 50);
  }, [listRef]);

  const onListHeaderLayout = useCallback((event: LayoutChangeEvent): void => {
    listHeaderHeightRef.current = event.nativeEvent.layout.height;
  }, []);

  const rendersToTarget = targetIndex > 0 && targetIndex <= MAX_RENDERED_TO_SELECTED;
  return {
    targetPath,
    listKey: rendersToTarget ? 'to-selected' : 'list',
    listProps: {
      initialNumToRender: rendersToTarget ? targetIndex + INITIAL_RENDER_COUNT : INITIAL_RENDER_COUNT,
      maintainVisibleContentPosition: isSettling ? MAINTAIN_VISIBLE_POSITION : undefined,
      onScrollToIndexFailed,
    },
    onListHeaderLayout,
    scrollToIndex,
  };
}

export type ScrollSelectedIntoScrollView = {
  onLayoutFor: (href: Href) => ((event: LayoutChangeEvent) => void) | undefined;
};

/**
 * Scrolls the selected row of a ScrollView into view by measuring it against the scroll view's content.
 */
export function useScrollSelectedIntoScrollView(scrollViewRef: RefObject<ScrollViewInstance | null>): ScrollSelectedIntoScrollView {
  const targetPath = useScrollTargetPath();
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
  return useMemo(() => ({ onLayoutFor }), [onLayoutFor]);
}
