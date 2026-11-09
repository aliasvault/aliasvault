import { useLocalSearchParams } from 'expo-router';

import { usePaneScreen } from '@/hooks/usePaneStack';
import { useTwoPane, type ScreenParams } from '@/hooks/useTwoPane';

/**
 * The params of the screen, in place of useLocalSearchParams: its route's, or on the primary pane of a two-pane layout,
 * where the screen is no route, the pane screen's (for the root screen: the tab's index route's).
 */
export function useScreenParams<T extends ScreenParams = ScreenParams>(): T {
  const routeParams = useLocalSearchParams();
  const paneScreen = usePaneScreen();
  const { pane, primaryParams } = useTwoPane();
  if (paneScreen) {
    return paneScreen.params as T;
  }
  if (pane === 'primary') {
    return primaryParams as T;
  }
  return routeParams as unknown as T;
}
