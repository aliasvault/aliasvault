import { useNavigation, type Href } from 'expo-router';
import { createContext, useCallback, useContext } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { useTwoPanePreference } from '@/hooks/useTwoPanePreference';

export { useTwoPanePreference } from '@/hooks/useTwoPanePreference';

/**
 * Narrowest window (points) that shows a list next to its detail: the open iPhone Duo in landscape (951 wide) and every
 * iPad in landscape, never a folded or plain iPhone. Width stands in for the UIKit size class, which React Native does not expose.
 */
const TWO_PANE_MIN_WIDTH = 600;

/** Shortest window that shows two panes; keeps a landscape iPhone, whose height is compact, on one pane. */
const TWO_PANE_MIN_HEIGHT = 500;

export type PaneName = 'primary' | 'secondary';

/** Route or screen params, as expo-router hands them to a screen. */
export type ScreenParams = Record<string, string | undefined>;

export type TwoPaneState = {
  isTwoPane: boolean;
  pane: PaneName | null;
  selectedPath: string | null;
  primaryParams: ScreenParams;
  setPrimaryParams: (params: ScreenParams) => void;
};

/** What every screen sees while the layout is off or the window is narrow. */
export const SINGLE_PANE_STATE: TwoPaneState = { isTwoPane: false, pane: null, selectedPath: null, primaryParams: {}, setPrimaryParams: () => undefined };

export const TwoPaneContext = createContext<TwoPaneState>(SINGLE_PANE_STATE);

/**
 * The two-pane state of the enclosing tab.
 */
export function useTwoPane(): TwoPaneState {
  return useContext(TwoPaneContext);
}

/**
 * Whether this subtree is a screen of a navigator (a route); false in the primary pane.
 */
export function useIsStackRoute(): boolean {
  return useTwoPane().pane !== 'primary';
}

type ScreenOptions = Record<string, unknown>;

/**
 * navigation.setOptions of the enclosing route; a no-op in the primary pane.
 */
export function useSetScreenOptions(): (options: ScreenOptions) => void {
  const navigation = useNavigation();
  const isStackRoute = useIsStackRoute();
  return useCallback((options: ScreenOptions): void => {
    if (isStackRoute) {
      navigation.setOptions(options as Parameters<typeof navigation.setOptions>[0]);
    }
  }, [navigation, isStackRoute]);
}

/**
 * Whether this iPhone can show two panes: an unfolded foldable.
 */
export function useIsFoldableIPhone(): boolean {
  const { width, height } = useWindowDimensions();
  return Platform.OS === 'ios' && !Platform.isPad && Math.min(width, height) >= TWO_PANE_MIN_WIDTH;
}

/**
 * Whether the two-pane layout is on for this device: every iPad, a foldable iPhone by its preference.
 * Undefined while the preference loads.
 */
export function useIsTwoPaneEnabled(): boolean | undefined {
  const [preference] = useTwoPanePreference();
  if (Platform.OS !== 'ios') {
    return false;
  }
  return Platform.isPad || preference;
}

/**
 * Whether the window shows two panes now: the layout is on and the window is landscape and wide enough.
 */
export function useIsTwoPaneWindow(): boolean {
  const enabled = useIsTwoPaneEnabled();
  const { width, height } = useWindowDimensions();
  return enabled === true && width > height && width >= TWO_PANE_MIN_WIDTH && height >= TWO_PANE_MIN_HEIGHT;
}

/**
 * The path a href navigates to, the way usePathname reports it.
 */
export function hrefToPath(href: Href): string {
  const pathname = typeof href === 'string' ? href : href.pathname;
  const params = (typeof href === 'string' ? {} : href.params ?? {}) as Record<string, unknown>;
  const filled = pathname.split('?')[0].replace(/\[([^\]]+)\]/g, (match, name: string) => (params[name] === undefined ? match : String(params[name])));
  const segments = filled.split('/').filter(segment => segment !== '' && !(segment.startsWith('(') && segment.endsWith(')')));
  return '/' + segments.join('/');
}

/**
 * Whether the secondary pane shows `href` or a route below it (an edit modal, a settings sub-page).
 */
export function isPathSelected(selectedPath: string | null, href: Href): boolean {
  if (selectedPath === null) {
    return false;
  }
  const path = hrefToPath(href);
  return selectedPath === path || selectedPath.startsWith(path + '/');
}

/**
 * Whether `href` (or a route below it) shows in the detail pane next to this subtree; false on a single pane or without a href.
 */
export function useIsSelectedRoute(href: Href | null): boolean {
  const { selectedPath } = useTwoPane();
  return href !== null && isPathSelected(selectedPath, href);
}
