import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColors } from '@/hooks/useColorScheme';
import { PaneStackContext, PaneStackScreensContext, PrimaryRoutesContext, usePaneStackRouteSync, usePaneStackState, type PaneScreen, type PrimaryRoute, type PrimaryRoutes } from '@/hooks/usePaneStack';
import { TwoPaneContext, useIsTwoPaneEnabled, useIsTwoPaneWindow, useTwoPane, type ScreenParams, type TwoPaneState } from '@/hooks/useTwoPane';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { PaneStack } from '@/components/ui/PaneStack';
import { StackScreenLayout } from '@/components/ui/StackScreenLayout';

const PRIMARY_WIDTH_FRACTION = 0.4;
const PRIMARY_MIN_WIDTH = 300;
const PRIMARY_MAX_WIDTH = 400;

const NO_PRIMARY_ROUTES: Record<string, PrimaryRoute> = {};

type TwoPaneLayoutProps = {
  path: string;
  /** The tab's root screen, shown in the primary pane; on a single pane it is the stack's index route instead. */
  primary: React.ReactNode;
  /** The root screen's title, the back title of the first screen pushed on the primary pane. */
  primaryTitle: string;
  /** The stack routes that show on the primary pane (folders), by route name as the Stack.Screen names them. */
  primaryRoutes?: Record<string, PrimaryRoute>;
  /** The tab's stack. */
  children: React.ReactNode;
};

/**
 * Shows a tab's root screen next to its stack in a wide landscape window (iPad, unfolded iPhone); otherwise the stack
 * alone. With the layout off the stack is the whole tree.
 */
export function TwoPaneLayout({ children, ...props }: TwoPaneLayoutProps): React.ReactNode {
  const isEnabledNow = useIsTwoPaneEnabled();
  const [enabled] = useState(isEnabledNow === true);
  if (!enabled) {
    return children;
  }
  return <EnabledTwoPaneLayout {...props}>{children}</EnabledTwoPaneLayout>;
}

/**
 * The layout with two panes available. Each pane has its own safe area provider, so a pane only insets for the screen
 * edges it touches. The primary pane has its own native stack (see PaneStack); the tab's index route moves screens
 * between it and the tab's stack when the window changes layout (see TwoPaneRoot).
 */
function EnabledTwoPaneLayout({ path, primary, primaryTitle, primaryRoutes = NO_PRIMARY_ROUTES, children }: TwoPaneLayoutProps): React.ReactNode {
  const colors = useColors();
  const isTwoPane = useIsTwoPaneWindow();
  const { width } = useWindowDimensions();
  const [primaryParams, setPrimaryParamsState] = useState<ScreenParams>({});
  const paneStack = usePaneStackState();

  const setPrimaryParams = useCallback((params: ScreenParams): void => setPrimaryParamsState(current => (isSameParams(current, params) ? current : params)), []);
  // Only the primary pane needs the selected path (see PrimaryPane), so this value never changes on navigation.
  const secondaryState = useMemo<TwoPaneState>(() => ({ isTwoPane, pane: isTwoPane ? 'secondary' : null, selectedPath: null, primaryParams, setPrimaryParams }), [isTwoPane, primaryParams, setPrimaryParams]);
  const primaryRoutesValue = useMemo<PrimaryRoutes>(() => ({ path, routes: primaryRoutes }), [path, primaryRoutes]);
  const titleOf = useCallback((screen: PaneScreen): string => primaryRoutes[screen.name]?.title(screen.params) ?? '', [primaryRoutes]);
  const renderScreen = useCallback((screen: PaneScreen): React.ReactNode => {
    const Route = primaryRoutes[screen.name]?.screen;
    return Route ? <Route /> : null;
  }, [primaryRoutes]);

  /*
   * One tree shape for both window layouts: the stack keeps its place, so unfolding or folding only adds or drops the
   * primary pane instead of remounting the stack (and reloading the detail screen on it).
   */
  const primaryWidth = Math.min(PRIMARY_MAX_WIDTH, Math.max(PRIMARY_MIN_WIDTH, Math.round(width * PRIMARY_WIDTH_FRACTION)));
  return (
    <PrimaryRoutesContext.Provider value={primaryRoutesValue}>
      <PaneStackContext.Provider value={paneStack.api}>
        <PaneStackScreensContext.Provider value={paneStack.screens}>
          <View style={styles.row}>
            {isTwoPane && (
              <PrimaryPane width={primaryWidth} primaryParams={primaryParams} setPrimaryParams={setPrimaryParams}>
                <PaneStack root={primary} rootTitle={primaryTitle} screens={paneStack.screens} onDismissed={paneStack.api.pop} titleOf={titleOf} renderScreen={renderScreen} />
              </PrimaryPane>
            )}
            {isTwoPane && <View style={[styles.divider, { backgroundColor: colors.headerBorder }]} />}
            <TwoPaneContext.Provider value={secondaryState}>
              <SafeAreaProvider style={styles.secondary}>{children}</SafeAreaProvider>
            </TwoPaneContext.Provider>
          </View>
        </PaneStackScreensContext.Provider>
      </PaneStackContext.Provider>
    </PrimaryRoutesContext.Provider>
  );
}

/**
 * Whether two param sets hold the same values.
 */
function isSameParams(a: ScreenParams, b: ScreenParams): boolean {
  return Object.keys({ ...a, ...b }).every(key => a[key] === b[key]);
}

type PrimaryPaneProps = {
  width: number;
  primaryParams: ScreenParams;
  setPrimaryParams: TwoPaneState['setPrimaryParams'];
  children: React.ReactNode;
};

/**
 * The primary pane. It alone follows the route shown in the secondary pane, so only this subtree re-renders on navigation.
 */
function PrimaryPane({ width, primaryParams, setPrimaryParams, children }: PrimaryPaneProps): React.ReactNode {
  const pathname = usePathname();
  const state = useMemo<TwoPaneState>(() => ({ isTwoPane: true, pane: 'primary', selectedPath: pathname, primaryParams, setPrimaryParams }), [pathname, primaryParams, setPrimaryParams]);
  return (
    <TwoPaneContext.Provider value={state}>
      <SafeAreaProvider style={{ width }}>
        <StackScreenLayout>{children}</StackScreenLayout>
      </SafeAreaProvider>
    </TwoPaneContext.Provider>
  );
}

type TwoPaneRootProps = {
  placeholderIcon: keyof typeof MaterialIcons.glyphMap;
  placeholderMessage: string;
  /** The tab's root screen. */
  children: React.ReactNode;
};

/**
 * The index route of a tab with a two-pane layout: the root screen on one pane; on two panes the empty detail pane,
 * while the layout renders the root screen itself and this route forwards its params to it and keeps the stack and
 * the pane in sync when the window changes layout.
 */
export function TwoPaneRoot({ placeholderIcon, placeholderMessage, children }: TwoPaneRootProps): React.ReactNode {
  const { isTwoPane, setPrimaryParams } = useTwoPane();
  const params = useLocalSearchParams();
  usePaneStackRouteSync();

  useEffect(() => {
    if (isTwoPane) {
      setPrimaryParams(params as ScreenParams);
    }
  }, [isTwoPane, params, setPrimaryParams]);

  if (isTwoPane) {
    return <DetailPlaceholder icon={placeholderIcon} message={placeholderMessage} />;
  }
  return children;
}

type DetailPlaceholderProps = {
  icon: keyof typeof MaterialIcons.glyphMap;
  message: string;
};

/**
 * Fills the secondary pane while nothing is selected.
 */
export function DetailPlaceholder({ icon, message }: DetailPlaceholderProps): React.ReactNode {
  const colors = useColors();
  return (
    <ThemedContainer style={styles.placeholder}>
      <MaterialIcons name={icon} size={56} color={colors.textMuted} style={styles.placeholderIcon} />
      <ThemedText style={[styles.placeholderText, { color: colors.textMuted }]}>{message}</ThemedText>
    </ThemedContainer>
  );
}

const styles = StyleSheet.create({
  divider: {
    width: StyleSheet.hairlineWidth,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  placeholderIcon: {
    marginBottom: 12,
    opacity: 0.5,
  },
  placeholderText: {
    fontSize: 16,
    textAlign: 'center',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  secondary: {
    flex: 1,
  },
});
