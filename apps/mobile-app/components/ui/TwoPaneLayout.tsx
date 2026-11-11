import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, usePathname, type Stack } from 'expo-router';
import { useVerticalBarEdgeIOS } from 'expo-status-bar';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View, type HostInstance, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useColors } from '@/hooks/useColorScheme';
import { LayoutChangeCacheContext } from '@/hooks/useLayoutChangeCache';
import { PaneStackContext, PrimaryRoutesContext, usePaneStackState, usePrimaryRoutes, type PaneScreen, type PrimaryRoute, type PrimaryRoutes } from '@/hooks/usePaneStack';
import { TwoPaneContext, useIsTwoPaneEnabled, useIsTwoPaneWindow, useTwoPane, type ScreenParams, type TwoPaneState } from '@/hooks/useTwoPane';

import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedText } from '@/components/themed/ThemedText';
import { PaneStack } from '@/components/ui/PaneStack';
import { StackScreenLayout } from '@/components/ui/StackScreenLayout';

const NO_PRIMARY_ROUTES: Record<string, PrimaryRoute> = {};

type Placeholder = { icon: keyof typeof MaterialIcons.glyphMap; message: string };

/** The placeholder of the empty detail pane, set by the tab's index route. */
const PlaceholderContext = createContext<{ placeholder: Placeholder | null; setPlaceholder: (placeholder: Placeholder) => void }>({ placeholder: null, setPlaceholder: () => undefined });

type StackOptions = Exclude<NonNullable<ComponentProps<typeof Stack.Screen>['options']>, (...args: never[]) => unknown>;

type TwoPaneLayoutProps = {
  path: string;
  /** The tab's root screen, shown in the primary pane; on a single pane it is the stack's index route instead. */
  primary: React.ReactNode;
  /** The root screen's title, the back title of the first screen pushed on the primary pane. */
  primaryTitle: string;
  /** The stack routes that show on the primary pane (folders), by route name as the Stack.Screen names them. */
  primaryRoutes?: Record<string, PrimaryRoute>;
  /** Whether the user hid the list, which makes the tab a single pane (see usePaneListToggleOptions). */
  isListHidden?: boolean;
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
 * edges it touches. The primary pane has its own native stack (see PaneStack), which mirrors the primary routes on the
 * tab's stack (see usePaneStackState).
 */
function EnabledTwoPaneLayout({ path, primary, primaryTitle, primaryRoutes = NO_PRIMARY_ROUTES, isListHidden = false, children }: TwoPaneLayoutProps): React.ReactNode {
  const colors = useColors();
  // A hidden list makes the tab a single pane, so going back from a screen leads straight to the list.
  const isTwoPane = useIsTwoPaneWindow() && !isListHidden;
  const [primaryParams, setPrimaryParamsState] = useState<ScreenParams>({});
  const paneStack = usePaneStackState(primaryRoutes);
  const [placeholder, setPlaceholder] = useState<Placeholder | null>(null);
  const placeholderState = useMemo(() => ({ placeholder, setPlaceholder }), [placeholder]);
  const [layoutChangeCache] = useState(() => new Map<string, unknown>());
  const { width: windowWidth } = useWindowDimensions();
  const rowRef = useRef<HostInstance>(null);
  const [rowX, setRowX] = useState<number | null>(null);
  const onRowLayout = useCallback((): void => rowRef.current?.measureInWindow(x => setRowX(x)), []);
  const railEdge = useVerticalBarEdgeIOS();
  useEffect(onRowLayout, [onRowLayout, windowWidth, railEdge]);

  const setPrimaryParams = useCallback((params: ScreenParams): void => setPrimaryParamsState(current => (isSameParams(current, params) ? current : params)), []);
  // Only the primary pane needs the selected path (see PrimaryPane), so this value never changes on navigation.
  const secondaryState = useMemo<TwoPaneState>(() => ({ isTwoPane, pane: isTwoPane ? 'secondary' : null, selectedPath: null, primaryParams, setPrimaryParams }), [isTwoPane, primaryParams, setPrimaryParams]);
  const primaryRoutesValue = useMemo<PrimaryRoutes>(() => ({ path, routes: primaryRoutes }), [path, primaryRoutes]);
  const titleOf = useCallback((screen: PaneScreen): string => primaryRoutes[screen.name]?.title(screen.params) ?? '', [primaryRoutes]);
  const renderTitle = useCallback((screen: PaneScreen): React.ReactNode => {
    const Title = primaryRoutes[screen.name]?.headerTitle;
    return Title ? <Title params={screen.params} /> : null;
  }, [primaryRoutes]);
  // On a single pane the tab's stack shows the route, and the pane keeps the native screen without content.
  const renderScreen = useCallback((screen: PaneScreen): React.ReactNode => {
    const Route = isTwoPane ? primaryRoutes[screen.name]?.screen : undefined;
    return Route ? <Route /> : null;
  }, [primaryRoutes, isTwoPane]);

  /*
   * The divider sits in the middle of the window, on the hinge of an unfolded iPhone Duo, so each pane matches the cover
   * display. The row starts after the bar rail, so the width is measured from the row's position in the window.
   */
  let primaryStyle: StyleProp<ViewStyle> = styles.primaryCollapsed;
  if (isTwoPane) {
    primaryStyle = rowX === null ? styles.primary : [styles.primaryCentered, { width: windowWidth / 2 - rowX }];
  }

  /*
   * One tree shape for both window layouts: the stack keeps its place, and the primary pane stays mounted (collapsed on a
   * single pane). Mounting or unmounting its native stack during the fold rotation adds or removes a child view controller
   * while UIKit enumerates them, which crashes the app.
   */
  return (
    <PrimaryRoutesContext.Provider value={primaryRoutesValue}>
      <PaneStackContext.Provider value={paneStack.api}>
        <LayoutChangeCacheContext.Provider value={layoutChangeCache}>
          <View ref={rowRef} style={styles.row} onLayout={onRowLayout}>
            <PrimaryPane isVisible={isTwoPane} style={primaryStyle} primaryParams={primaryParams} setPrimaryParams={setPrimaryParams}>
              <PaneStack root={isTwoPane ? primary : null} rootTitle={primaryTitle} screens={paneStack.screens} onDismissed={paneStack.api.dismissed} titleOf={titleOf} renderTitle={renderTitle} renderScreen={renderScreen} />
            </PrimaryPane>
            {isTwoPane && <View style={[styles.divider, { backgroundColor: colors.headerBorder }]} />}
            <TwoPaneContext.Provider value={secondaryState}>
              <PlaceholderContext.Provider value={placeholderState}>
                <SafeAreaProvider style={styles.secondary}>{children}</SafeAreaProvider>
              </PlaceholderContext.Provider>
            </TwoPaneContext.Provider>
          </View>
        </LayoutChangeCacheContext.Provider>
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
  isVisible: boolean;
  style: StyleProp<ViewStyle>;
  primaryParams: ScreenParams;
  setPrimaryParams: TwoPaneState['setPrimaryParams'];
  children: React.ReactNode;
};

/**
 * The primary pane. It alone follows the route shown in the secondary pane, so only this subtree re-renders on navigation.
 */
function PrimaryPane({ isVisible, style, primaryParams, setPrimaryParams, children }: PrimaryPaneProps): React.ReactNode {
  const pathname = usePathname();
  const state = useMemo<TwoPaneState>(() => ({ isTwoPane: true, pane: 'primary', selectedPath: pathname, primaryParams, setPrimaryParams }), [pathname, primaryParams, setPrimaryParams]);
  return (
    <TwoPaneContext.Provider value={state}>
      <SafeAreaProvider style={style} pointerEvents={isVisible ? 'auto' : 'none'}>
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
 * while the layout renders the root screen itself and this route forwards its params to it.
 */
export function TwoPaneRoot({ placeholderIcon, placeholderMessage, children }: TwoPaneRootProps): React.ReactNode {
  const { isTwoPane, setPrimaryParams } = useTwoPane();
  const params = useLocalSearchParams();
  const { setPlaceholder } = useContext(PlaceholderContext);

  useEffect(() => setPlaceholder({ icon: placeholderIcon, message: placeholderMessage }), [placeholderIcon, placeholderMessage, setPlaceholder]);

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

/**
 * The `screenLayout` of a tab's stack that has primary routes.
 */
export function twoPaneScreenLayout({ route, children }: { route: { name: string }; children: React.ReactElement }): React.ReactElement {
  return <TwoPaneScreen routeName={route.name}>{children}</TwoPaneScreen>;
}

/**
 * A screen of the tab's stack; on two panes a primary route shows the placeholder, as the primary pane renders it.
 */
function TwoPaneScreen({ routeName, children }: { routeName: string; children: React.ReactElement }): React.ReactNode {
  const { isTwoPane } = useTwoPane();
  const primaryRoutes = usePrimaryRoutes();
  const { placeholder } = useContext(PlaceholderContext);
  const isShownOnPane = isTwoPane && primaryRoutes !== null && routeName in primaryRoutes.routes;
  return <StackScreenLayout>{isShownOnPane ? placeholder && <DetailPlaceholder {...placeholder} /> : children}</StackScreenLayout>;
}

/**
 * The options of a primary route on a tab's stack: on two panes it shows the placeholder, without back button, animation
 * or back gesture. Its header stays, since one that appears during a fold rotation loses its title view.
 */
export function usePrimaryRouteOptions(): StackOptions {
  const isTwoPane = useIsTwoPaneWindow();
  return useMemo((): StackOptions => (isTwoPane ? { headerBackVisible: false, animation: 'none', gestureEnabled: false } : {}), [isTwoPane]);
}

/**
 * The `screenOptions` of a tab's stack: on two panes, a header button that hides or shows the list next to the open screen.
 */
export function usePaneListToggleOptions(isListHidden: boolean, setListHidden: (hidden: boolean) => void): StackOptions {
  const { t } = useTranslation();
  const isTwoPane = useIsTwoPaneWindow();
  return useMemo((): StackOptions => {
    if (!isTwoPane) {
      return {};
    }
    // A left bar item replaces the back button unless the back button is asked for.
    return {
      headerBackVisible: true,
      unstable_headerLeftItems: () => [{
        type: 'button',
        label: isListHidden ? t('common.showList') : t('common.expand'),
        icon: { type: 'sfSymbol', name: isListHidden ? 'arrow.down.right.and.arrow.up.left' : 'arrow.up.left.and.arrow.down.right' },
        onPress: () => setListHidden(!isListHidden),
      }],
    };
  }, [isTwoPane, isListHidden, setListHidden, t]);
}

type DetailPlaceholderProps = Placeholder;

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
  primary: {
    flex: 1,
    overflow: 'hidden',
  },
  primaryCentered: {
    flex: 0,
    overflow: 'hidden',
  },
  // Invisible at about its two-pane width, so its native headers keep their layout.
  primaryCollapsed: {
    bottom: 0,
    left: 0,
    opacity: 0,
    overflow: 'hidden',
    position: 'absolute',
    top: 0,
    width: 440,
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
