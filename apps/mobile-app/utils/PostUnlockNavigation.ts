import { Href } from 'expo-router';
import { Linking } from 'react-native';

/**
 * Post-unlock navigation options.
 */
export type PostUnlockNavigationOptions = {
  /**
   * Return URL from app context (for reinitialize flow).
   */
  returnUrl?: { path: string; params?: Record<string, string> } | null;

  /**
   * Router instance for navigation.
   */
  router: {
    replace: (href: Href) => void;
    push: (href: Href) => void;
  };

  /**
   * Clear the return URL from app context.
   */
  clearReturnUrl?: () => void;
}

/**
 * Centralized post-unlock navigation logic.
 * Handles pending deep links, return URLs, and default navigation.
 * This ensures consistent navigation behavior across all unlock flows:
 * - initialize.tsx (cold boot with biometric unlock)
 * - unlock.tsx (manual password/PIN unlock)
 * - reinitialize.tsx (vault lock due to timeout, requiring unlock again)
 */
export class PostUnlockNavigation {
  /**
   * Navigate to the appropriate destination after successful vault unlock.
   * Priority order:
   * 1. Return URL (from reinitialize flow or _layout.tsx)
   * 2. Default credentials tab
   */
  static navigate(options: PostUnlockNavigationOptions): void {
    const { returnUrl, router, clearReturnUrl } = options;

    // Priority 1: Handle return URL (from reinitialize flow)
    if (returnUrl?.path) {
      this.handleReturnUrl(returnUrl, router);
      if (clearReturnUrl) {
        clearReturnUrl();
      }
      return;
    }

    // Priority 2: Default navigation to items
    router.replace('/(tabs)/items');
  }

  /**
   * Handle return URL navigation (from reinitialize flow).
   */
  private static handleReturnUrl(
    returnUrl: { path: string; params?: Record<string, string> | undefined },
    router: PostUnlockNavigationOptions['router']
  ): void {
    // Normalize the path using centralized function
    const normalizedPath = this.normalizeDeepLinkPath(returnUrl.path);
    const params = returnUrl.params || {};

    // Check if this is a detail route (has a sub-page after the tab)
    const isItemRoute = normalizedPath.includes('/(tabs)/items/');
    const isSettingsRoute = normalizedPath.includes('/(tabs)/settings/') &&
                           !normalizedPath.endsWith('/(tabs)/settings');

    if (isItemRoute) {
      // Navigate to items tab first, then push detail page
      router.replace('/(tabs)/items');
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
      router.replace({
        pathname: normalizedPath as '/',
        params: params as Record<string, string>
      });
    }
  }

  /**
   * Normalize a deep link or path to ensure it has the correct /(tabs)/ prefix.
   * Exported for use in _layout.tsx and other navigation logic.
   *
   * Supports:
   * - Action-based URLs: aliasvault://open/mobile-unlock/[id]
   * - Direct routes: aliasvault://items/[id], aliasvault://settings/[page]
   */
  private static normalizeDeepLinkPath(urlOrPath: string): string {
    // Remove all URL schemes first
    let path = urlOrPath
      .replace('net.aliasvault.app://', '')
      .replace('aliasvault://', '')
      .replace('exp+aliasvault://', '');

    // If it already has /(tabs)/ prefix, return as is
    if (path.startsWith('/(tabs)/')) {
      return path;
    }

    // Handle item paths
    if (path.startsWith('items/') || path.includes('/items/')) {
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
  }
}
