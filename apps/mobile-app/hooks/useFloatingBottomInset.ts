import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Distance of the iPhone Duo bar rail from the screen edge; it ignores the 34pt bottom safe area, so floating views line up with it. */
export const RAIL_EDGE_MARGIN = 24;

/**
 * Bottom offset for a floating view: `gap` above the tab bar, or level with the bottom of the iPhone Duo rail when the rail holds the tab bar.
 */
export function useFloatingBottomInset(gap: number): number {
  const insets = useSafeAreaInsets();
  const railEdge = useVerticalBarEdgeIOS();
  if (Platform.OS !== 'ios') {
    return gap;
  }
  return railEdge ? Math.max(RAIL_EDGE_MARGIN, gap) : insets.bottom + gap;
}
