import { useNavigation, useRoute } from 'expo-router';
import { useNavigationState } from 'expo-router/react-navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

import { useTwoPane, type ScreenParams } from '@/hooks/useTwoPane';

export type PaneScreen = { name: string; params: ScreenParams };

/** A screen on the pane stack: a primary route of the tab's stack, under that route's key. */
export type PaneStackEntry = PaneScreen & { key: string };

/** A pane stack screen in a transition; a new one has no key until the stack router creates it. */
export type PaneStackRoute = PaneScreen & { key?: string };

/** A stack route that shows on the primary pane; `headerTitle` replaces the plain title in the pane's header. */
export type PrimaryRoute = { screen: React.ComponentType; title: (params: ScreenParams) => string; headerTitle?: React.ComponentType<{ params: ScreenParams }> };

export type PrimaryRoutes = { path: string; routes: Record<string, PrimaryRoute> };

/** Navigation on the pane stack; the functions are stable. */
export type PaneStackApi = {
  push: (screen: PaneScreen) => void;
  pop: (count?: number) => void;
  popToRoot: () => void;
  popTo: (matches: (screen: PaneScreen) => boolean, screen: PaneScreen) => void;
  setParams: (key: string, params: ScreenParams) => void;
  replace: (key: string, screen: PaneScreen) => void;
  dismissed: (key: string, count: number) => void;
};

export type PaneHeaderViews = { right?: React.ReactNode };

export type PaneScreenInfo = { key: string; params: ScreenParams; headerHeight: number; setHeaderViews: (views: PaneHeaderViews) => void };

export const PaneStackContext = createContext<PaneStackApi | null>(null);
export const PrimaryRoutesContext = createContext<PrimaryRoutes | null>(null);
export const PaneScreenContext = createContext<PaneScreenInfo | null>(null);

/**
 * The pane stack of the enclosing tab while it shows two panes, usable from both panes; null otherwise.
 */
export function usePaneStack(): PaneStackApi | null {
  const { isTwoPane } = useTwoPane();
  const api = useContext(PaneStackContext);
  return isTwoPane ? api : null;
}

/**
 * The pane stack screen this subtree renders in; null elsewhere.
 */
export function usePaneScreen(): PaneScreenInfo | null {
  return useContext(PaneScreenContext);
}

/**
 * Shows `views` in the pane stack header of this screen; a no-op off the pane stack. Pass a memoized object.
 */
export function usePaneHeaderViews(views: PaneHeaderViews): void {
  const setHeaderViews = usePaneScreen()?.setHeaderViews;
  useEffect(() => {
    if (!setHeaderViews) {
      return undefined;
    }
    setHeaderViews(views);
    return (): void => setHeaderViews({});
  }, [setHeaderViews, views]);
}

/**
 * The primary routes of the enclosing tab layout; null without a two-pane layout.
 */
export function usePrimaryRoutes(): PrimaryRoutes | null {
  return useContext(PrimaryRoutesContext);
}

/*
 * The transitions of the stack are pure functions of the screens, so they can be read without React.
 */

/**
 * The screens with `screen` on top.
 */
export function pushScreen(screens: PaneStackRoute[], screen: PaneScreen): PaneStackRoute[] {
  return [...screens, { name: screen.name, params: screen.params }];
}

/**
 * The screens without the top `count`.
 */
export function popScreens(screens: PaneStackRoute[], count: number): PaneStackRoute[] {
  return screens.slice(0, Math.max(0, screens.length - count));
}

/**
 * The screens up to the topmost one that matches, or `fallback` alone when none does.
 */
export function popToScreen(screens: PaneStackRoute[], matches: (screen: PaneScreen) => boolean, fallback: PaneScreen): PaneStackRoute[] {
  for (let index = screens.length - 1; index >= 0; index--) {
    if (matches(screens[index])) {
      return screens.slice(0, index + 1);
    }
  }
  return [{ name: fallback.name, params: fallback.params }];
}

/**
 * The screens with `params` merged into the one with `key`.
 */
export function setScreenParams(screens: PaneStackRoute[], key: string, params: ScreenParams): PaneStackRoute[] {
  return screens.map(entry => (entry.key === key ? { ...entry, params: { ...entry.params, ...params } } : entry));
}

/**
 * The screens with the one with `key` replaced by `screen`, under the same key.
 */
export function replaceScreen(screens: PaneStackRoute[], key: string, screen: PaneScreen): PaneStackRoute[] {
  return screens.map(entry => (entry.key === key ? { name: screen.name, params: screen.params, key } : entry));
}

/**
 * The screens after a native dismissal of `count` screens that ended at the one with `key`; unchanged when it already left.
 */
export function dismissScreens(screens: PaneStackRoute[], key: string, count: number): PaneStackRoute[] {
  const index = screens.findIndex(entry => entry.key === key);
  return index === -1 ? screens : screens.slice(0, Math.max(0, index - count + 1));
}

/**
 * The names of the dynamic segments of a route name: `folder/[manifestId]/[id]` gives manifestId and id.
 */
export function dynamicParamNames(name: string): string[] {
  return [...name.matchAll(/\[([^\]]+)\]/g)].map(match => match[1]);
}

/**
 * Whether two screens show the same thing: the same route with the same values for its dynamic segments.
 */
export function isSameScreen(a: PaneScreen, b: PaneScreen): boolean {
  return a.name === b.name && dynamicParamNames(a.name).every(param => a.params[param] === b.params[param]);
}

/** A route of the tab's stack; a route without a key is one the router still has to create. */
type StackRoute = { key?: string; name: string; params?: object };

/** The tab's stack state, as far as the pane stack uses it. */
type StackState = { key: string; index: number; routes: StackRoute[] };

/** The tab navigator's state and navigation, as far as the pane stack uses them. */
type TabsState = { routes: Array<{ key: string; state?: StackState }> };
type TabNavigation = { getState: () => TabsState | undefined; dispatch: (action: object) => void };

const NO_PARAMS: ScreenParams = {};

/**
 * The route as a pane stack screen.
 */
function toPaneScreen(route: StackRoute): PaneStackRoute {
  return { key: route.key, name: route.name, params: (route.params ?? NO_PARAMS) as ScreenParams };
}

/*
 * The pane stack has no state of its own: its screens are the primary routes on the tab's stack. Both sides keep a native
 * screen for each and a layout change only swaps which side renders the content, because pushing or popping native
 * screens during a fold rotation crashes UIKit or shows up late.
 */

/**
 * The screens of the pane stack of the tab whose layout calls this, and the stable API that changes them.
 */
export function usePaneStackState(primaryRoutes: Record<string, PrimaryRoute>): { screens: PaneStackEntry[]; api: PaneStackApi } {
  const navigation = useNavigation() as unknown as TabNavigation;
  const tabKey = useRoute().key;
  const stack = useNavigationState(tabs => (tabs as unknown as TabsState).routes.find(route => route.key === tabKey)?.state);

  // Kept stable while the primary routes are unchanged, so detail navigation does not re-render the pane stack.
  const shown = useRef<{ routes: StackRoute[]; screens: PaneStackEntry[] }>({ routes: [], screens: [] });
  const screens = useMemo((): PaneStackEntry[] => {
    const routes = (stack?.routes ?? []).filter(route => route.key !== undefined && route.name in primaryRoutes);
    if (routes.length !== shown.current.routes.length || routes.some((route, index) => route !== shown.current.routes[index])) {
      shown.current = { routes, screens: routes.map(toPaneScreen) as PaneStackEntry[] };
    }
    return shown.current.screens;
  }, [stack, primaryRoutes]);

  /**
   * Applies a transition to the primary routes, which sit between the tab's root and the detail routes.
   */
  const update = useCallback((change: (current: PaneStackRoute[]) => PaneStackRoute[]): void => {
    const current = navigation.getState()?.routes.find(route => route.key === tabKey)?.state;
    if (!current) {
      return;
    }
    const isPrimary = (route: StackRoute): boolean => route.name in primaryRoutes;
    const primary = current.routes.filter(isPrimary);
    const before = primary.map(toPaneScreen);
    const after = change(before);
    if (after.length === before.length && after.every((screen, index) => screen === before[index])) {
      return;
    }
    // A route that did not change stays the same object, so its screen is not re-rendered.
    const routes = after.map((screen): StackRoute => {
      const index = before.indexOf(screen);
      if (index !== -1) {
        return primary[index];
      }
      return { ...primary.find(route => route.key !== undefined && route.key === screen.key), name: screen.name, params: screen.params };
    });
    const others = current.routes.filter(route => !isPrimary(route));
    const next = [...others.slice(0, 1), ...routes, ...others.slice(1)];
    if (next.length > 0) {
      navigation.dispatch({ type: 'RESET', payload: { ...current, routes: next, index: next.length - 1 }, target: current.key });
    }
  }, [navigation, tabKey, primaryRoutes]);

  const api = useMemo<PaneStackApi>(() => ({
    push: (screen): void => update(current => pushScreen(current, screen)),
    pop: (count = 1): void => update(current => popScreens(current, count)),
    popToRoot: (): void => update(() => []),
    popTo: (matches, screen): void => update(current => popToScreen(current, matches, screen)),
    setParams: (key, params): void => update(current => setScreenParams(current, key, params)),
    replace: (key, screen): void => update(current => replaceScreen(current, key, screen)),
    dismissed: (key, count): void => update(current => dismissScreens(current, key, count)),
  }), [update]);

  return { screens, api };
}
