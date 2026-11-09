import { useHeaderHeight } from 'expo-router/react-navigation';
import { Platform } from 'react-native';

import { usePaneScreen } from '@/hooks/usePaneStack';

/**
 * Height of the native header that overlaps the screen content: the transparent iOS header, 0 on Android where the header is opaque.
 */
export function useHeaderInset(): number {
  const headerHeight = useHeaderHeight();
  const paneScreen = usePaneScreen();
  if (Platform.OS !== 'ios') {
    return 0;
  }
  // On the pane stack the screen's header is the pane's, not the route's.
  return paneScreen ? paneScreen.headerHeight : headerHeight;
}
