import type { Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { LayoutChangeEvent } from 'react-native';

import { isPathSelected, useTwoPane } from '@/hooks/useTwoPane';

const INITIAL_RENDER_COUNT = 14;
const MAX_RENDERED_TO_SELECTED = 500;
const MAX_SCROLL_RETRIES = 30;
const SETTLE_DURATION = 3000;
const MAINTAIN_VISIBLE_POSITION = { minIndexForVisible: 0 };

type ScrollableList = {
  scrollToIndex: (params: { index: number; viewPosition?: number; animated?: boolean }) => void;
  scrollToOffset: (params: { offset: number; animated?: boolean }) => void;
};

type Options<Row> = {
  rows: readonly Row[];
  isLoaded: boolean;
  rowHref: (row: Row) => Href;
  rowKey: (row: Row) => string;
};

export type ScrollSelectedRow = {
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
 * Scrolls the row of the detail shown next to a FlatList into the middle of it, once, when the primary pane appears (the
 * phone is unfolded). A FlatList only scrolls to a row exactly once every row above it is measured, so it mounts again with
 * those rows rendered (up to a cap). The target is kept by key, as a restored search or sort may still reorder the rows.
 * Lists that render every row use useScrollSelectedIntoView instead.
 */
export function useScrollSelectedRowIntoView<Row>(listRef: RefObject<ScrollableList | null>, { rows, isLoaded, rowHref, rowKey }: Options<Row>): ScrollSelectedRow {
  const { pane, selectedPath } = useTwoPane();
  const targetDoneRef = useRef(false);
  const retriesRef = useRef(0);
  const listHeaderHeightRef = useRef(0);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [isSettling, setIsSettling] = useState(false);

  useEffect(() => {
    if (pane !== 'primary' || targetDoneRef.current || !isLoaded) {
      return;
    }
    targetDoneRef.current = true;
    const selected = rows.find(row => isPathSelected(selectedPath, rowHref(row)));
    if (selected) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- runs once, after the first load in the primary pane
      setTargetKey(rowKey(selected));
    }
  }, [pane, isLoaded, rows, selectedPath, rowHref, rowKey]);

  const targetIndex = useMemo(() => (targetKey === null ? -1 : rows.findIndex(row => rowKey(row) === targetKey)), [targetKey, rows, rowKey]);

  const scrollToIndex = useCallback((index: number, animated: boolean): void => {
    retriesRef.current = 0;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated });
  }, [listRef]);

  useEffect(() => {
    if (targetIndex <= 0) {
      return;
    }
    // While the rows above settle, keep the visible rows in place instead of letting their real heights shift them.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- toggles a list prop for the duration of the scroll
    setIsSettling(true);
    const frame = requestAnimationFrame(() => scrollToIndex(targetIndex, false));
    const settle = setTimeout(() => setIsSettling(false), SETTLE_DURATION);
    return (): void => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [targetIndex, scrollToIndex]);

  /*
   * A row past the rendered rows has no measured offset yet: jump towards it (header plus the rows at their average
   * height, which iOS clamps to the end of the rendered content), which renders the next rows, then try again.
   */
  const onScrollToIndexFailed = useCallback(({ index, averageItemLength }: { index: number; averageItemLength: number }): void => {
    listRef.current?.scrollToOffset({ offset: listHeaderHeightRef.current + index * averageItemLength, animated: false });
    if (retriesRef.current >= MAX_SCROLL_RETRIES) {
      return;
    }
    retriesRef.current++;
    setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false }), 50);
  }, [listRef]);

  const onListHeaderLayout = useCallback((event: LayoutChangeEvent): void => {
    listHeaderHeightRef.current = event.nativeEvent.layout.height;
  }, []);

  const rendersToTarget = targetIndex > 0 && targetIndex <= MAX_RENDERED_TO_SELECTED;
  return {
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
