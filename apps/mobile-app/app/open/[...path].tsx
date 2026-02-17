import { Href, useRouter, useLocalSearchParams, useGlobalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useNavigation } from '@/context/NavigationContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

// Declare __DEV__ global for TypeScript (provided by React Native runtime)
declare const __DEV__: boolean;

/**
 * Action-based deep link handler for special actions triggered from outside the app.
 *
 * URL structure: aliasvault://open/[action]/[...params]
 *
 * Supported actions:
 * - mobile-unlock/[requestId] - Mobile device unlock via QR code
 * - __debug__/set-offline/[true|false] - (DEV only) Toggle offline mode for E2E testing
 * - __debug__/set-api-url/[encoded-url] - (DEV only) Set API URL for E2E testing
 * - __debug__/set-server-revision/[number] - (DEV only) Set local server revision for RPO testing
 *
 * This route exists to handle deep links that Expo Router processes before our
 * Linking.addEventListener can intercept them. It provides proper navigation
 * flow for each action type.
 */
export default function ActionHandler() : null {
  const router = useRouter();
  const params = useGlobalSearchParams();
  const localParams = useLocalSearchParams();
  const { setReturnUrl } = useNavigation();
  const hasNavigated = useRef<boolean>(false);

  useEffect(() => {
    if (hasNavigated.current) {
      return;
    }

    // Get the path segments (first segment is the action)
    const pathSegments = (params.path || localParams.path) as string[] | string | undefined;
    const pathArray = Array.isArray(pathSegments) ? pathSegments : pathSegments ? [pathSegments] : [];

    if (pathArray.length === 0) {
      // No action specified, go to items
      router.replace('/(tabs)/items');
      hasNavigated.current = true;
      return;
    }

    const [action, ...actionParams] = pathArray;

    // Handle different action types
    switch (action) {
      case 'mobile-unlock': {
        // Mobile unlock action: $/mobile-unlock/[requestId]
        const requestId = actionParams[0];
        if (!requestId) {
          console.error('[ActionHandler] mobile-unlock requires requestId');
          router.replace('/(tabs)/settings');
          hasNavigated.current = true;
          return;
        }

        /*
         * Check if vault is unlocked. If the app was opened via deep link while auto-locked,
         * the vault will be locked. In this case, redirect to /reinitialize first to unlock
         * the vault, then forward to the mobile-unlock URL.
         */
        NativeVaultManager.isVaultUnlocked().then((isUnlocked: boolean) => {
          if (hasNavigated.current) {
            // Already navigated, skip
            return;
          }

          if (!isUnlocked) {
            // Set return URL to forward to mobile-unlock after reinitialize completes
            setReturnUrl({
              path: `/(tabs)/settings/mobile-unlock/${requestId}`,
              params: params.pk ? { pk: params.pk as string } : undefined,
            });
            router.replace('/reinitialize');
          } else {
            // Vault is unlocked, navigate directly to mobile-unlock
            router.replace(`/(tabs)/settings/mobile-unlock/${requestId}` as Href);
          }
          hasNavigated.current = true;
        }).catch(() => {
          // Error checking vault status, try navigating anyway
          router.replace(`/(tabs)/settings/mobile-unlock/${requestId}` as Href);
          hasNavigated.current = true;
        });
        break;
      }

      /**
       * ----------------------------------------------------------------------------
       * Debug actions for E2E testing (only works in dev mode)
       * ----------------------------------------------------------------------------
       */
      case '__debug__': {
        if (!__DEV__) {
          console.warn('[ActionHandler] Debug actions only available in development');
          router.replace('/(tabs)/items');
          hasNavigated.current = true;
          return;
        }

        const [debugAction, ...debugParams] = actionParams;

        switch (debugAction) {
          case 'set-offline': {
            // Set offline mode: aliasvault://open/__debug__/set-offline/true
            const isOffline = debugParams[0] === 'true';
            console.debug('[ActionHandler] Setting offline mode:', isOffline);
            NativeVaultManager.setOfflineMode(isOffline)
              .then(() => {
                console.debug('[ActionHandler] Offline mode set to:', isOffline);
              })
              .catch((error: Error) => {
                console.error('[ActionHandler] Failed to set offline mode:', error);
              });
            router.replace('/(tabs)/items');
            hasNavigated.current = true;
            break;
          }

          case 'set-api-url': {
            /*
             * Set API URL: aliasvault://open/__debug__/set-api-url/http%3A%2F%2Flocalhost%3A5092
             * Note: If slashes in URL aren't encoded, they become separate path segments
             * So we join all remaining params with '/' to reconstruct the URL
             */
            if (debugParams.length === 0) {
              console.error('[ActionHandler] set-api-url requires URL parameter');
              router.replace('/(tabs)/items');
              hasNavigated.current = true;
              return;
            }
            // Join params back together (handles both encoded and unencoded slashes)
            const joinedUrl = debugParams.join('/');
            const url = decodeURIComponent(joinedUrl);
            console.debug('[ActionHandler] Setting API URL:', url);
            NativeVaultManager.setApiUrl(url)
              .then(() => {
                console.debug('[ActionHandler] API URL set to:', url);
              })
              .catch((error: Error) => {
                console.error('[ActionHandler] Failed to set API URL:', error);
              });
            router.replace('/(tabs)/items');
            hasNavigated.current = true;
            break;
          }

          default:
            console.warn('[ActionHandler] Unknown debug action:', debugAction);
            router.replace('/(tabs)/items');
            hasNavigated.current = true;
            break;
        }
        break;
      }

      default:
        // Unknown action, log and go to items
        console.warn('[ActionHandler] Unknown action:', action);
        router.replace('/(tabs)/items');
        hasNavigated.current = true;
        break;
    }
  }, [params, localParams, router, hasNavigated, setReturnUrl]);

  return null;
}
