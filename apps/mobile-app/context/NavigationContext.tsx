import { Href, useRouter, usePathname, useGlobalSearchParams } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import NativeVaultManager from '@/specs/NativeVaultManager';

type NavigationContextType = {
  /**
   * Return URL to navigate to after successful vault unlock.
   * This is set when the app is backgrounded and vault is locked.
   */
  returnUrl: { path: string; params?: Record<string, string> } | null;

  /**
   * Set the return URL for post-unlock navigation.
   */
  setReturnUrl: (url: { path: string; params?: Record<string, string> } | null) => void;

  /**
   * Navigate to the appropriate destination after successful vault unlock.
   * Handles return URLs and default navigation to credentials tab.
   */
  navigateAfterUnlock: () => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

/**
 * NavigationProvider to provide centralized navigation logic, particularly for post-unlock flows.
 */
export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const [returnUrl, setReturnUrl] = useState<{ path: string; params?: Record<string, string> } | null>(null);
  const appState = useRef(AppState.currentState);
  const lastRouteRef = useRef<{ path: string, params?: object }>({ path: pathname, params });

  // Track current route for vault lock recovery
  useEffect(() => {
    lastRouteRef.current = { path: pathname, params };
  }, [pathname, params]);

  /**
   * Navigate to the appropriate destination after successful vault unlock.
   * Priority order:
   * 1. Return URL (from reinitialize flow or _layout.tsx)
   * 2. Default credentials tab
   */
  const navigateAfterUnlock = useCallback((): void => {
    // Priority 1: Handle return URL (from reinitialize flow)
    if (returnUrl?.path) {
      const url = returnUrl;
      setReturnUrl(null);
      handleReturnUrl(url, router);
      return;
    }

    // Priority 2: Default navigation to credentials
    router.replace('/(tabs)/credentials');
  }, [returnUrl, router]);

  /**
   * Handle return URL navigation (from reinitialize flow).
   */
  const handleReturnUrl = (
    returnUrl: { path: string; params?: Record<string, string> },
    router: ReturnType<typeof useRouter>
  ): void => {
    // Normalize the path using centralized function
    const normalizedPath = normalizeDeepLinkPath(returnUrl.path);
    const params = returnUrl.params || {};

    // Check if this is a detail route (has a sub-page after the tab)
    const isCredentialRoute = normalizedPath.includes('/(tabs)/credentials/');
    const isSettingsRoute = normalizedPath.includes('/(tabs)/settings/') &&
                           !normalizedPath.endsWith('/(tabs)/settings');

    if (isCredentialRoute) {
      // Navigate to credentials tab first, then push detail page
      router.replace('/(tabs)/credentials');
      setTimeout(() => {
        const queryParams = new URLSearchParams(params as Record<string, string>).toString();
        const targetUrl = queryParams ? `${normalizedPath}?${queryParams}` : normalizedPath;
        router.push(targetUrl as Href);
      }, 0);
    } else if (isSettingsRoute) {
      // Navigate to settings tab first, then push detail page
      router.replace('/(tabs)/settings');
      setTimeout(() => {
        const queryParams = new URLSearchParams(params as Record<string, string>).toString();
        const targetUrl = queryParams ? `${normalizedPath}?${queryParams}` : normalizedPath;
        router.push(targetUrl as Href);
      }, 0);
    } else {
      // Direct navigation for root tab routes
      // If there are query params, append them as query string
      if (Object.keys(params).length > 0) {
        const queryParams = new URLSearchParams(params as Record<string, string>).toString();
        const targetUrl = `${normalizedPath}?${queryParams}`;
        router.replace(targetUrl as Href);
      } else {
        router.replace(normalizedPath as Href);
      }
    }
  };

  /**
   * Normalize a deep link or path to ensure it has the correct /(tabs)/ prefix.
   *
   * Supports:
   * - Action-based URLs: aliasvault://open/mobile-unlock/[id]
   * - Direct routes: aliasvault://credentials/[id], aliasvault://settings/[page]
   */
  const normalizeDeepLinkPath = (urlOrPath: string): string => {
    // Remove all URL schemes first
    let path = urlOrPath
      .replace('net.aliasvault.app://', '')
      .replace('aliasvault://', '')
      .replace('exp+aliasvault://', '');

    // If it already has /(tabs)/ prefix, return as is
    if (path.startsWith('/(tabs)/')) {
      return path;
    }

    // Handle credential paths
    if (path.startsWith('credentials/') || path.includes('/credentials/')) {
      if (!path.startsWith('/')) {
        path = `/${path}`;
      }
      return `/(tabs)${path}`;
    }

    // Handle settings paths
    if (path.startsWith('settings/') || path.startsWith('/settings')) {
      if (!path.startsWith('/')) {
        path = `/${path}`;
      }
      return `/(tabs)${path}`;
    }

    return path;
  };

  /**
   * Check if the vault is unlocked.
   */
  const isVaultUnlocked = useCallback(async (): Promise<boolean> => {
    try {
      return await NativeVaultManager.isVaultUnlocked();
    } catch (error) {
      console.error('Failed to check vault status:', error);
      return false;
    }
  }, []);

  /**
   * Handle app state changes - detect when vault is locked and save return URL.
   */
  useEffect(() => {
    const appstateSubscription = AppState.addEventListener('change', async (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        /**
         * App coming to foreground
         * Skip vault re-initialization checks during unlock, login, initialize, and reinitialize flows to prevent race conditions
         * where the AppState listener fires during app initialization, especially on iOS release builds.
         * Also skip during mobile-unlock flow as it has its own authentication.
         */
        if (!pathname?.startsWith('/unlock') &&
            !pathname?.startsWith('/login') &&
            !pathname?.startsWith('/initialize') &&
            !pathname?.startsWith('/reinitialize') &&
            !pathname?.includes('/mobile-unlock/')) {
          try {
            // Check if vault is unlocked.
            const isUnlocked = await isVaultUnlocked();
            if (!isUnlocked) {
              // Get current full URL including query params
              const currentRoute = lastRouteRef.current;
              if (currentRoute?.path) {
                setReturnUrl({
                  path: currentRoute.path,
                  params: currentRoute.params as Record<string, string>
                });
              }

              // Database connection failed, navigate to reinitialize flow
              router.replace('/reinitialize');
            }
          } catch {
            // Database query failed, navigate to reinitialize flow
            router.replace('/reinitialize');
          }
        }
      }
      appState.current = nextAppState;
    });

    return (): void => {
      appstateSubscription.remove();
    };
  }, [isVaultUnlocked, pathname, router]);

  const contextValue = useMemo(() => ({
    returnUrl,
    setReturnUrl,
    navigateAfterUnlock,
  }), [returnUrl, navigateAfterUnlock]);

  return (
    <NavigationContext.Provider value={contextValue}>
      {children}
    </NavigationContext.Provider>
  );
};

/**
 * Hook to use the NavigationContext.
 */
export const useNavigation = (): NavigationContextType => {
  const context = useContext(NavigationContext);
  if (context === undefined) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
};
