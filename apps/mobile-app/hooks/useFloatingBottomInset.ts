import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom offset for a floating view: `gap` above the tab bar, or on the safe-area edge when the iPhone Duo rail holds the tab bar.
 */
export function useFloatingBottomInset(gap: number): number {
  const insets = useSafeAreaInsets();
  const railEdge = useVerticalBarEdgeIOS();
  if (Platform.OS !== 'ios') {
    return gap;
  }
  return railEdge ? Math.max(insets.bottom, gap) : insets.bottom + gap;
}
