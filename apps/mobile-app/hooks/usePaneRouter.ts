import { useNavigation, useRouter, type Href } from 'expo-router';
// Internal expo-router path, not public API: recheck it on every expo-router upgrade.
import { INTERNAL_EXPO_ROUTER_NO_ANIMATION_PARAM_NAME } from 'expo-router/build/navigationParams';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

import { isSameScreen, usePaneScreen, usePaneStack, usePrimaryRoutes, type PaneScreen, type PrimaryRoutes } from '@/hooks/usePaneStack';
import { hrefToPath, useTwoPane, type ScreenParams } from '@/hooks/useTwoPane';

/**
 * expo-router's router, with one verb more: `openDetail` shows a detail next to a list where the layout has two panes,
 * and pushes it elsewhere.
 */
export type PaneRouter = {
  push: (href: Href) => void;
  replace: (href: Href) => void;
  back: () => void;
  dismissTo: (href: Href) => void;
  setParams: (params: ScreenParams) => void;
  openDetail: (href: Href, options?: OpenDetailOptions) => void;
};

export type OpenDetailOptions = {
  reuseScreen?: boolean;
};

/** A href resolved against the primary routes: the tab's root, a screen of a primary route, or null for any other href. */
type ResolvedHref = 'root' | PaneScreen | null;

/**
 * The params as strings, the way a screen receives them.
 */
function stringParams(params: object | undefined): ScreenParams {
  return Object.fromEntries(Object.entries(params ?? {}).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
}

/**
 * The params of a query string.
 */
function queryParams(query: string): ScreenParams {
  return Object.fromEntries(query.split('&').filter(pair => pair !== '').map(pair => {
    const [key, value = ''] = pair.split('=');
    return [decodeURIComponent(key), decodeURIComponent(value)];
  }));
}

/**
 * Resolves a href against the primary routes of a tab layout: the object form by its route pattern, the string form by
 * matching its filled-in segments and query.
 */
export function resolvePrimaryHref(href: Href, primary: PrimaryRoutes): ResolvedHref {
  if (typeof href !== 'string') {
    if (href.pathname === primary.path || href.pathname === `${primary.path}/index`) {
      return 'root';
    }
    const name = href.pathname.startsWith(`${primary.path}/`) ? href.pathname.slice(primary.path.length + 1) : null;
    return name !== null && name in primary.routes ? { name, params: stringParams(href.params) } : null;
  }

  const [pathPart, query = ''] = href.split('?');
  if (pathPart === primary.path || pathPart === `${primary.path}/index`) {
    return 'root';
  }
  for (const name of Object.keys(primary.routes)) {
    const paramNames: string[] = [];
    const segments = `${primary.path}/${name}`.split('/').map(segment => {
      const dynamic = /^\[(.+)\]$/.exec(segment);
      if (dynamic) {
        paramNames.push(dynamic[1]);
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    const match = new RegExp(`^${segments.join('/')}$`).exec(pathPart);
    if (match) {
      const params = queryParams(query);
      paramNames.forEach((paramName, index) => {
        params[paramName] = decodeURIComponent(match[index + 1]);
      });
      return { name, params };
    }
  }
  return null;
}

/**
 * The href with expo-router's no-animation param, so the Stack shows the route without its push animation, like a native
 * split view swaps its detail. The param is internal to expo-router, which strips it before the screen sees its params.
 */
function withoutAnimation(href: Href): Href {
  if (typeof href === 'string') {
    return `${href}${href.includes('?') ? '&' : '?'}${INTERNAL_EXPO_ROUTER_NO_ANIMATION_PARAM_NAME}=true` as Href;
  }
  return { ...href, params: { ...(href.params ?? {}), [INTERNAL_EXPO_ROUTER_NO_ANIMATION_PARAM_NAME]: 'true' } } as Href;
}

/**
 * The router of a screen in a tab with a two-pane layout.
 */
export function usePaneRouter(): PaneRouter {
  const router = useRouter();
  const navigation = useNavigation();
  const paneStack = usePaneStack();
  const paneScreen = usePaneScreen();
  const primary = usePrimaryRoutes();
  const { pane, selectedPath } = useTwoPane();
  const selectedPathRef = useRef(selectedPath);
  useLayoutEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  /*
   * The detail replaces the one shown next to the primary pane.
   */
  const openDetail = useCallback((href: Href, options?: OpenDetailOptions): void => {
    if (!paneStack || pane !== 'primary') {
      router.push(href);
      return;
    }
    const tabsState = navigation.getState();
    const stack = tabsState?.routes[tabsState.index]?.state;
    const stackRoutes = stack?.routes ?? [];
    // The details sit on top of the tab's root and the primary routes, which stay on the stack below them.
    const detailCount = stackRoutes.filter(route => !primary || !(route.name in primary.routes)).length - 1;
    if (detailCount <= 0) {
      router.push(withoutAnimation(href));
      return;
    }
    if (hrefToPath(href) === selectedPathRef.current) {
      return;
    }
    const top = stackRoutes[stackRoutes.length - 1];
    if (options?.reuseScreen && detailCount === 1 && stack?.key && primary && typeof href !== 'string' && top?.name === href.pathname.slice(primary.path.length + 1)) {
      navigation.dispatch({ type: 'SET_PARAMS', payload: { params: href.params ?? {} }, source: top.key, target: stack.key });
      return;
    }
    if (detailCount > 1) {
      router.dismiss(detailCount - 1);
    }
    router.replace(withoutAnimation(href));
  }, [paneStack, pane, router, navigation, primary]);

  return useMemo<PaneRouter>(() => {
    if (!paneStack || !primary) {
      return { push: router.push, replace: router.replace, back: router.back, dismissTo: router.dismissTo, setParams: router.setParams, openDetail };
    }
    /**
     * The href against the tab's primary routes.
     */
    const resolve = (href: Href): ResolvedHref => resolvePrimaryHref(href, primary);
    return {
      push: (href): void => {
        const target = resolve(href);
        if (target === null) {
          router.push(href);
        } else if (target === 'root') {
          paneStack.popToRoot();
        } else {
          paneStack.push(target);
        }
      },
      replace: (href): void => {
        const target = resolve(href);
        if (target === null) {
          router.replace(href);
        } else if (target === 'root') {
          paneStack.popToRoot();
        } else if (paneScreen) {
          paneStack.replace(paneScreen.key, target);
        } else {
          paneStack.push(target);
        }
      },
      back: (): void => {
        if (paneScreen) {
          paneStack.pop();
        } else {
          router.back();
        }
      },
      dismissTo: (href): void => {
        const target = resolve(href);
        if (target === null) {
          router.dismissTo(href);
        } else if (target === 'root') {
          paneStack.popToRoot();
        } else {
          paneStack.popTo(screen => isSameScreen(screen, target), target);
        }
      },
      setParams: (params): void => {
        if (paneScreen) {
          paneStack.setParams(paneScreen.key, params);
        } else {
          router.setParams(params);
        }
      },
      openDetail: (href, options): void => {
        const target = resolve(href);
        if (target === null) {
          openDetail(href, options);
        } else if (target === 'root') {
          paneStack.popToRoot();
        } else {
          paneStack.push(target);
        }
      },
    };
  }, [paneStack, primary, paneScreen, router, openDetail]);
}
