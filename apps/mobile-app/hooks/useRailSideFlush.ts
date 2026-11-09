import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import type { ViewStyle } from 'react-native';

/**
 * Padding override that lets content hug the iPhone Duo bar rail, so it ends where the header bar ends; null without a rail.
 */
export function useRailSideFlush(): ViewStyle | null {
  const edge = useVerticalBarEdgeIOS();
  if (edge === 'trailing') {
    return { paddingEnd: 0 };
  }
  if (edge === 'leading') {
    return { paddingStart: 0 };
  }
  return null;
}

/**
 * Styles for a list whose rows hug the iPhone Duo bar rail: the list does not clip, so the long-press lift of a row is
 * not cut off at the rail edge, while the list (and its scroll indicator) still ends at the rail; empty without a rail.
 */
export function useRailSideBleed(): { style?: ViewStyle; contentContainerStyle?: ViewStyle } {
  const flush = useRailSideFlush();
  return flush ? { style: { overflow: 'visible' }, contentContainerStyle: flush } : {};
}
