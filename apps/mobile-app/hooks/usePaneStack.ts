import { useNavigation } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useTwoPane, type ScreenParams } from '@/hooks/useTwoPane';

export type PaneScreen = { 
  name: string; 
  params: ScreenParams;
};

export type PaneStackEntry = PaneScreen & { 
  key: string;
};

export type PrimaryRoute = { 
  screen: React.ComponentType; 
  title: (params: ScreenParams) => string;
};

export type PrimaryRoutes = { 
  path: string; 
  routes: Record<string, PrimaryRoute>;
};

/** Navigation on the pane stack; the functions are stable. */
export type PaneStackApi = {
  push: (screen: PaneScreen) => void;
  pop: (count?: number) => void;
  popToRoot: () => void;
  popTo: (matches: (screen: PaneScreen) => boolean, screen: PaneScreen) => void;
  setParams: (key: string, params: ScreenParams) => void;
  replace: (key: string, screen: PaneScreen) => void;
};

export type PaneHeaderViews = { 
  title?: React.ReactNode; 
  right?: React.ReactNode; 
};

export type PaneScreenInfo = { 
  key: string; 
  params: ScreenParams; 
  headerHeight: number; 
  setHeaderViews: (views: PaneHeaderViews) => void;
};

export const PaneStackContext = createContext<PaneStackApi | null>(null);
export const PaneStackScreensContext = createContext<PaneStackEntry[]>([]);
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
 * The transitions of the stack are pure functions of the screens, so they can be read and tested without React.
 */
let nextKey = 0;

/**
 * The screen as an entry with a new key.
 */
function withKey(screen: PaneScreen): PaneStackEntry {
  return { ...screen, key: `pane-${++nextKey}` };
}

/**
 * The screens with `screen` on top.
 */
export function pushScreen(screens: PaneStackEntry[], screen: PaneScreen): PaneStackEntry[] {
  return [...screens, withKey(screen)];
}

/**
 * The screens without the top `count`.
 */
export function popScreens(screens: PaneStackEntry[], count: number): PaneStackEntry[] {
  return screens.slice(0, Math.max(0, screens.length - count));
}

/**
 * The screens up to the topmost one that matches, or `fallback` alone when none does.
 */
export function popToScreen(screens: PaneStackEntry[], matches: (screen: PaneScreen) => boolean, fallback: PaneScreen): PaneStackEntry[] {
  for (let index = screens.length - 1; index >= 0; index--) {
    if (matches(screens[index])) {
      return screens.slice(0, index + 1);
    }
  }
  return [withKey(fallback)];
}

/**
 * The screens with `params` merged into the one with `key`.
 */
export function setScreenParams(screens: PaneStackEntry[], key: string, params: ScreenParams): PaneStackEntry[] {
  return screens.map(entry => (entry.key === key ? { ...entry, params: { ...entry.params, ...params } } : entry));
}

/**
 * The screens with the one with `key` replaced by `screen`, under the same key.
 */
export function replaceScreen(screens: PaneStackEntry[], key: string, screen: PaneScreen): PaneStackEntry[] {
  return screens.map(entry => (entry.key === key ? { ...screen, key } : entry));
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

/**
 * Owns the screens of a pane stack and the stable API that changes them.
 */
export function usePaneStackState(): { screens: PaneStackEntry[]; api: PaneStackApi } {
  const [screens, setScreens] = useState<PaneStackEntry[]>([]);

  const push = useCallback((screen: PaneScreen): void => setScreens(current => pushScreen(current, screen)), []);
  const pop = useCallback((count: number = 1): void => setScreens(current => popScreens(current, count)), []);
  const popToRoot = useCallback((): void => setScreens([]), []);
  const popTo = useCallback((matches: (screen: PaneScreen) => boolean, screen: PaneScreen): void => setScreens(current => popToScreen(current, matches, screen)), []);
  const setParams = useCallback((key: string, params: ScreenParams): void => setScreens(current => setScreenParams(current, key, params)), []);
  const replace = useCallback((key: string, screen: PaneScreen): void => setScreens(current => replaceScreen(current, key, screen)), []);

  const api = useMemo<PaneStackApi>(() => ({ push, pop, popToRoot, popTo, setParams, replace }), [push, pop, popToRoot, popTo, setParams, replace]);
  return { screens, api };
}

/** The tab's stack state and navigation, as far as the sync uses them; a route without a key is one the router still has to create. */
type StackState = { index: number; routes: Array<{ key?: string; name: string; params?: object }> };
type StackNavigation = { getState: () => StackState | undefined; reset: (state: StackState) => void };

/**
 * Moves screens between the tab's stack and the pane stack when the window changes layout, from a screen on the stack
 * (the tab's index route). On unfolding, the primary routes on the stack leave it for the pane; on folding, the pane's
 * screens go on the stack below the routes already there, so a folder stays open either way.
 */
export function usePaneStackRouteSync(): void {
  const navigation = useNavigation() as unknown as StackNavigation;
  const { isTwoPane } = useTwoPane();
  const api = useContext(PaneStackContext);
  const screens = useContext(PaneStackScreensContext);
  const primaryRoutes = usePrimaryRoutes();
  const wasTwoPane = useRef(isTwoPane);

  useEffect(() => {
    if (wasTwoPane.current === isTwoPane || !api || !primaryRoutes) {
      return;
    }
    wasTwoPane.current = isTwoPane;
    const state = navigation.getState();
    if (!state) {
      return;
    }
    if (isTwoPane) {
      const isPrimary = (route: StackState['routes'][number]): boolean => route.name in primaryRoutes.routes;
      if (!state.routes.some(isPrimary)) {
        return;
      }
      state.routes.filter(isPrimary).forEach(route => api.push({ name: route.name, params: (route.params ?? {}) as ScreenParams }));
      const routes = state.routes.filter(route => !isPrimary(route));
      navigation.reset({ ...state, routes, index: routes.length - 1 });
      return;
    }
    if (screens.length === 0) {
      return;
    }
    // Keys are left out on purpose: the stack router creates them. The routes already there keep theirs, and their screens.
    const [root, ...rest] = state.routes;
    const routes = [root, ...screens.map(({ name, params }) => ({ name, params })), ...rest];
    navigation.reset({ ...state, routes, index: routes.length - 1 });
    api.popToRoot();
  }, [isTwoPane, api, screens, navigation, primaryRoutes]);
}
