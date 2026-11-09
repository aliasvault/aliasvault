import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import type { ViewStyle } from 'react-native';

import { useTwoPane } from '@/hooks/useTwoPane';

/**
 * Padding override that lets content hug the iPhone Duo bar rail, so it ends where the header bar ends.
 */
export function useRailSideFlush(): ViewStyle | null {
  const edge = useVerticalBarEdgeIOS();
  const { pane } = useTwoPane();
  if (edge === 'trailing' && pane !== 'primary') {
    return { paddingEnd: 0 };
  }
  if (edge === 'leading' && pane !== 'secondary') {
    return { paddingStart: 0 };
  }
  return null;
}

/**
 * Styles for a list whose rows hug the iPhone Duo bar rail: the list does not clip, so the long-press lift of a row is
 * not cut off at the rail edge, while the list (and its scroll indicator) still ends at the rail.
 */
export function useRailSideBleed(): { style?: ViewStyle; contentContainerStyle?: ViewStyle } {
  const flush = useRailSideFlush();
  return flush ? { style: { overflow: 'visible' }, contentContainerStyle: flush } : {};
}
