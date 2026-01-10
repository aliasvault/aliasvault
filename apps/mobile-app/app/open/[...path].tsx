import { Href, useRouter, useLocalSearchParams, useGlobalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

/**
 * Action-based deep link handler for special actions triggered from outside the app.
 *
 * URL structure: aliasvault://open/[action]/[...params]
 *
 * Supported actions:
 * - mobile-unlock/[requestId] - Mobile device unlock via QR code
 *
 * This route exists to handle deep links that Expo Router processes before our
 * Linking.addEventListener can intercept them. It provides proper navigation
 * flow for each action type.
 */
export default function ActionHandler() : null {
  const router = useRouter();
  const params = useGlobalSearchParams();
  const localParams = useLocalSearchParams();
  const [hasNavigated, setHasNavigated] = useState(false);

  useEffect(() => {
    if (hasNavigated) {
      return;
    }

    // Get the path segments (first segment is the action)
    const pathSegments = (params.path || localParams.path) as string[] | string | undefined;
    const pathArray = Array.isArray(pathSegments) ? pathSegments : pathSegments ? [pathSegments] : [];

    if (pathArray.length === 0) {
      // No action specified, go to items
      router.replace('/(tabs)/items');
      setHasNavigated(true);
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
          setHasNavigated(true);
          return;
        }

        // First navigate to settings tab to establish correct navigation stack
        router.replace(`/(tabs)/settings/mobile-unlock/${requestId}` as Href);
        setHasNavigated(true);
        break;
      }

      default:
        // Unknown action, log and go to items
        console.warn('[ActionHandler] Unknown action:', action);
        router.replace('/(tabs)/items');
        setHasNavigated(true);
        break;
    }
  }, [params, localParams, router, hasNavigated]);

  return null;
}
